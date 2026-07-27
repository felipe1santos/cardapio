# Cancelamento de pedido no Kanban + múltiplos turnos de funcionamento

Data: 2026-07-27

Duas entregas independentes, cada uma commitável sozinha.

---

## Parte 1 — Cancelar pedido no Kanban

### Problema

O operador não consegue cancelar um pedido feito pela vitrine depois que ele saiu da
coluna "Pedido Recebido". Pedidos de teste ficam presos no fluxo e sujam o kanban, a
logística e o faturamento.

Hoje existe apenas o botão `✕` (função `recusar`) no card de status `recebido`, que chama
`recusarPedido()` — um `update status='cancelado'` cru, sem motivo, sem autoria e **sem
reverter os benefícios de fidelidade** (cupom consumido, recompensa resgatada). A rota do
PDV (`/api/admin/pdv/pedido/[id]/cancelar`) já reverte; o kanban não. É um bug existente
que esta entrega corrige de passagem.

### Escopo

- Cancelável: `recebido`, `preparando`, `pronto`, `em_rota`.
- Não cancelável: `entregue`, `cancelado`.
- Motivo **obrigatório**, escolhido de uma lista fechada, com texto livre em `outro`.

### Modelo de dados

Migration `0046_pedido_cancelamento.sql`, aditiva e idempotente:

```sql
alter table pedidos add column if not exists cancelado_motivo text;
alter table pedidos add column if not exists cancelado_observacao text;
alter table pedidos add column if not exists cancelado_por text;
alter table pedidos add column if not exists cancelado_em timestamptz;
```

Motivos (slug gravado em `cancelado_motivo`):

| slug | rótulo |
|---|---|
| `teste` | Pedido teste |
| `cliente_desistiu` | Cliente desistiu |
| `sem_estoque` | Sem estoque |
| `trote` | Trote / cliente inexistente |
| `outro` | Outro motivo |

`outro` exige `cancelado_observacao` não vazia. Os demais aceitam observação opcional.

Colunas nulas em pedidos já cancelados antes desta migration — esperado, é histórico.

### Rota `POST /api/admin/pedidos/[id]/cancelar`

Espelha a rota do PDV. Corpo: `{ motivo: string, observacao?: string }`.

1. Autentica pela sessão (`getServerSupabase` → `buscarRestauranteIdDoUsuario`). Sem
   restaurante → 401.
2. Valida `motivo` contra a lista fechada; valida `observacao` não vazia quando
   `motivo === 'outro'`. Inválido → 400.
3. Update com cliente admin, escopado em `restaurante_id` **e** guardado por status:
   `.not('status', 'in', '(entregue,cancelado)')`, com `.select()` para contar linhas.
   Zero linhas → 409 "Pedido já finalizado ou cancelado".
   Grava: `status='cancelado'`, motivo, observação, `cancelado_por`, `cancelado_em`,
   e `reimprimir = false`.
4. `reverterBeneficiosPedidoCancelado(admin, restauranteId, id)` — fogo-e-esquece, igual
   ao PDV.

`cancelado_por` = e-mail do usuário da sessão (`auth.getUser()`), ou `'—'` se ausente.

**Por que `reimprimir = false`:** a fila do agente de impressão
(`lib/queries/impressao.ts:239`) casa `reimprimir.eq.true` **em qualquer status**. Sem
limpar a flag, um pedido cancelado com reimpressão pendente ainda sairia na impressora.

**Por que a guarda de status é server-side:** o botão some na UI para pedido entregue,
mas a UI não é fonte de verdade. Dois operadores em telas diferentes podem colidir.

**`entregador_id` é preservado** — é histórico de quem estava com o pedido. O pedido sai
sozinho das telas de logística e do fechamento de caixa do entregador, porque todas
filtram por `status in ('em_rota','entregue')`.

### Cliente final

Após o update, o kanban chama `notificarPedido(id, 'cancelado')`, o mesmo caminho já usado
pelo `recusar` atual. A timeline da vitrine reflete o cancelamento.

### UI

Ação no **rodapé do drawer de Detalhes**, abaixo de "Reimprimir pedido":

```
┌ Pedido #142 ─────────────── × ┐
│ Linha do tempo               │
│ Itens do pedido              │
│ Cliente & pagamento          │
│ Endereço                     │
├──────────────────────────────┤
│ [ 🖨  REIMPRIMIR PEDIDO     ] │
│ [ ✕  CANCELAR PEDIDO       ] │ ← outline vermelho
└──────────────────────────────┘
```

Botão oculto quando `detail.status` é `entregue` ou `cancelado`.

Clique abre modal central (overlay `#111827/45`, card branco `rounded-menuzia`,
`max-w-[420px]`):

- Título: `Cancelar pedido #142`
- Linha de contexto: cliente · total · status atual
- 5 pills de motivo, seleção única (pill ativa: borda `--primary`, fundo `--bg-alert`)
- Textarea de observação: sempre visível, `required` visualmente quando `outro`
- `[Voltar]` (secondary) · `[Confirmar cancelamento]` (fundo `--danger`, branco,
  desabilitado até ter motivo válido)

Confirmar: remove o card otimista, fecha modal e drawer, `refetch`. Erro → mensagem no
modal e `refetch` para ressincronizar.

O `✕` do card de pedido novo continua existindo, mas passa a abrir **o mesmo modal** — um
caminho de cancelamento só, um registro de motivo só. A função `recusar` antiga e a query
`recusarPedido` saem.

---

## Parte 2 — Múltiplos turnos de funcionamento

### Problema

`restaurantes.horario_funcionamento` é `{"1": {"abre":"18:00","fecha":"23:00"}}` — **um**
intervalo por dia. Uma loja que vende marmita ao meio-dia e pizza à noite não consegue
fechar no intervalo da tarde.

Segundo problema: `horaDentroDoIntervalo` é `hora >= inicio && hora < fim`, o que torna
`18:00–02:00` sempre falso. Loja que vira a noite hoje fecha errado à meia-noite.

### Modelo de dados

Migration `0047_horario_turnos.sql` — nenhuma coluna nova, só muda o formato do jsonb:

```
antes:  {"1": {"abre":"18:00","fecha":"23:00"}}
depois: {"1": [{"abre":"11:00","fecha":"14:00"},{"abre":"18:00","fecha":"02:00"}]}
```

Backfill em SQL: cada objeto vira array de um elemento. `null` continua `null` (dia
fechado). Ausência total da chave continua significando "nunca configurou" → loja sempre
aberta, comportamento preservado.

### `lib/timezone.ts`

- `HorarioFuncionamento` vira `Record<string, HorarioDia[] | null>`.
- **Leitura tolerante ao formato antigo:** `Array.isArray(v) ? v : [v]`. A migration roda
  no Supabase remoto e o deploy do app pode chegar antes ou depois dela; sem isso existe
  uma janela em que toda loja aparece fechada por erro de parse.
- `horaDentroDoIntervalo` passa a tratar a virada:

```ts
inicio < fim
  ? hora >= inicio && hora < fim   // mesmo dia
  : hora >= inicio || hora < fim   // atravessa a meia-noite
```

- `lojaEstaAberta` checa os turnos de **hoje** mais os turnos de **ontem que atravessam a
  meia-noite**. Sem a segunda checagem, à 01:00 de terça a loja fecha mesmo com o turno de
  segunda indo até 02:00.
- Novo `proximaAbertura(grade)`: varre até 7 dias à frente e devolve
  `{ diaSemana: number, hora: string } | null`. `null` = grade sem nenhum turno.

`grupoEstaAtivoAgora` passa a usar o mesmo `horaDentroDoIntervalo`, ganhando suporte a
virada de meia-noite de graça. Categoria continua com **um** intervalo — já resolve
marmita/pizza, pois cada categoria cai dentro de um turno.

### UI Ajustes

`app/admin/ajustes/page.tsx`, campo "Horário de funcionamento": cada dia vira lista de
turnos.

```
☑ Segunda   [11:00] → [14:00]  [✕]
            [18:00] → [02:00]  [✕]  ↳ vira 02:00 do dia seguinte
            + adicionar turno
☐ Domingo   fechado
```

- Marcar o dia cria o primeiro turno com o padrão atual (`08:00–22:00`).
- Remover o último turno desmarca o dia.
- Aviso inline quando `fecha <= abre` explicando que o turno vira o dia.
- Validação client-side: turnos do mesmo dia não podem se sobrepor. Salvar fica bloqueado
  com mensagem no campo.

### Vitrine

`RestauranteVitrine` (`lib/queries/cardapio.ts`) ganha `proximaAbertura`, calculado junto
com `lojaAberta`. O badge de loja fechada em `app/loja/[slug]/page.tsx` passa de
`Fechado` para:

- `Fechado · abre às 18:00` (ainda hoje)
- `Fechado · abre amanhã às 11:00`
- `Fechado · abre sábado às 11:00`
- `Fechado` (sem próximo turno)

### Testes

`lib/timezone.test.ts` cobre:

- turno único, dentro e fora
- dois turnos, incluindo o vão entre eles
- turno que atravessa a meia-noite: antes, durante (antes e depois de 00:00), depois
- grade no formato antigo (objeto único) lida corretamente
- grade `null` = sempre aberta
- override manual `aberto_manual` / `fechado_manual` prevalece
- `proximaAbertura` no mesmo dia, no dia seguinte e virando a semana

---

## Sequência

1. Migration 0046 + rota de cancelamento + UI do modal + remoção do `recusar` antigo.
2. Migration 0047 + `timezone.ts` + testes + UI de turnos em Ajustes + badge da vitrine.
