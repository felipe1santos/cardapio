# PDV — Status & Handoff (continuar depois)

> Documento de retomada. Atualizado: 2026-06-27. Tudo na branch `main` (deploy Coolify lê main).

## Visão geral do sub-projeto PDV

PDV = **serviço de mesa** (não caixa puro). Atendente lança pedido numa mesa → vai pro
Kanban + cozinhas em tempo real com tag `PDV` + nº da mesa → cliente come → paga no fim ao
**fechar a mesa**. Dividido em 3 fases:

- **Fase 1 — PDV + mesa + tag.** ✅ FEITO (falta só aplicar 1 migration no remoto).
- **Fase 2 — Comanda de mesa (controle de mesas + fechar conta).** 🟡 DESIGN APROVADO PARCIAL — falta 1 confirmação, spec, plano, implementação.
- **Fase 3 — Controle de caixa (pagamento no fechamento + conferência por turno).** ⬜ NÃO INICIADA (só ideia de alto nível).

Specs/planos:
- Spec Fase 1: `docs/superpowers/specs/2026-06-27-pdv-mesa-design.md`
- Plano Fase 1: `docs/superpowers/plans/2026-06-27-pdv-mesa-fase1.md`
- Ledger SDD: `.superpowers/sdd/progress.md` (git-ignored)

---

## ⚠️ AÇÃO PENDENTE CRÍTICA (fazer antes de usar o PDV)

**Aplicar a migration `supabase/migrations/0033_pdv_mesas.sql` no banco remoto.**
- `npm run db:setup` está QUEBRADO neste projeto (morre em 0020 por coluna já existente).
- Aplicar SQL direto via pg, usando `DATABASE_URL` do `.env.local`. SQL é idempotente.
- Sem isso: `/admin/pdv` e os selects de pedido quebram (colunas `pedidos.origem`/`mesa` e
  tabela `mesas` não existem no remoto).
- Conteúdo: `pedidos.origem text default 'cardapio'`, `pedidos.mesa text`, tabela `mesas`
  (RLS via `auth_restaurante_id()`).

---

## ✅ FASE 1 — FEITO (commits `099bdfa`..`57ccd4a` na main)

Tudo aditivo, vitrine intacta. tsc/build limpos, final review = SHIP.

| # | Entrega | Arquivos |
|---|---------|----------|
| 1 | Migration `0033_pdv_mesas.sql` (origem/mesa + tabela mesas + RLS) + propagação em `criarPedido`/`Pedido`/`PedidoRow`/`PEDIDO_SELECT`/`mapPedido`/`NovoPedidoInput` | `supabase/migrations/0033_pdv_mesas.sql`, `lib/queries/pedidos.ts` |
| 2 | CRUD de mesas + `mapMesaRow` (teste 2/2) | `lib/queries/mesas.ts`, `lib/queries/mesas.test.ts` |
| 3 | Aba "Mesas" em Ajustes (`TabMesas`, copiou padrão `TabEstacoes`) | `app/admin/ajustes/page.tsx` |
| 4 | Route `POST /api/admin/pdv/pedido` (auth por sessão, força `origem=pdv`/`tipo=retirada`) | `app/api/admin/pdv/pedido/route.ts` |
| 5 | Tela `/admin/pdv` (focus-mode; grade de mesas + Balcão; cardápio busca/categorias; seletor self-contained pizza/tamanho/complementos; comanda + "Lançar na cozinha") + item na sidebar | `app/admin/pdv/page.tsx`, `app/admin/layout.tsx`, `components/layout/sidebar.tsx` |
| 6 | Tag `PDV` (Badge tone="alert") + `Mesa X`/`Balcão` nos cards do Kanban e cozinhas; vitrine sem tag (guard `origem==='pdv'`) | `app/admin/pedidos/page.tsx`, `app/cozinha/[token]/page.tsx` |
| 7 | Nota fixa de paleta/fonte (Inter) no topo da seção 3 do CLAUDE.md | `CLAUDE.md` |
| fix | Seletor abre p/ complementos opcionais também; rótulo "Balcão" sem prefixo "Mesa" | `app/admin/pdv/page.tsx`, `app/admin/pedidos/page.tsx`, `app/cozinha/[token]/page.tsx` |

**Pontos-chave do código (pra retomar):**
- `criarPedido(admin, restauranteId, input: NovoPedidoInput)` em `lib/queries/pedidos.ts:835`
  é o criador central de pedido (vitrine + PDV usam). `NovoPedidoInput.origem?` default
  `'cardapio'`; `mesa?` só quando `origem==='pdv'`.
- `PEDIDO_SELECT`/`mapPedido` (`lib/queries/pedidos.ts:111`/`:119`) = ponto único que leva
  `origem`/`mesa` pra Kanban/cozinha/logística/rotas.
- `forma_pagamento` é `NOT NULL default 'pix'` — pedido de mesa nasce `pago=false`, forma
  real só na Fase 3. Card mostra "conta aberta" no lugar do badge de pagamento.
- `tipo='retirada'` no pedido de mesa → NÃO entra na Logística, fica no Kanban.
- `mesas` cadastradas em `/admin/ajustes` aba "Mesas". `listarMesasAtivas` alimenta a grade do PDV.

**Minors conhecidos (aceitos pra Fase 1, possível polir depois):**
- `listarMesasAtivas` filtra em JS (mesas são poucas — ok).
- Pizza sem `tamanhos_padrao_pizza` configurado deixa Confirm desabilitado (fail-safe).
- Route não valida schema do body em runtime (`criarPedido` rejeita — ok).
- "Subtotal (ref.)" na comanda usa preço base (servidor recalcula o real — ok).

---

## 🟡 FASE 2 — Comanda de mesa (DESIGN APROVADO, FALTA 1 CONFIRMAÇÃO)

### Decisões já tomadas com o usuário
- **Onde fica:** dentro do PDV (`/admin/pdv` vira mesa-aware) — sem tela nova.
- **Fechar mesa (Fase 2):** só fecha a conta (mostra total, marca comanda fechada, libera a
  mesa). Pagamento/caixa = Fase 3.
- **Corrigir comanda antes de fechar:** SIM — pode cancelar um pedido (lançamento) inteiro
  da comanda. (NÃO remove linha solta de pedido em preparo — evita inconsistência com cozinha.)

### Design proposto (aprovado, exceto a pergunta aberta abaixo)

**Modelo de dados — nova migration (provável `0034_comandas.sql`):**
```sql
create table if not exists comandas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  mesa_id uuid not null references mesas(id) on delete cascade,
  status text not null default 'aberta',   -- 'aberta' | 'fechada'
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz
);
-- no máx. 1 comanda aberta por mesa (evita corrida):
create unique index if not exists comandas_mesa_aberta_unq
  on comandas (restaurante_id, mesa_id) where status = 'aberta';
alter table pedidos add column if not exists comanda_id uuid references comandas(id);
-- RLS por tenant via auth_restaurante_id() (mesmo padrão de mesas/pedidos).
```

**Fluxo:**
- `/api/admin/pdv/pedido` (e `criarPedido`) ganham passo **find-or-create** da comanda aberta
  da mesa → liga `pedido.comanda_id`. Balcão (sem mesa) continua avulso, sem comanda.
- Mesa "ocupada" = tem comanda aberta. Grade de mesas no PDV mostra estado ocupado + total
  acumulado.
- Selecionar mesa ocupada → painel da comanda: pedidos lançados (itens, status cozinha,
  valor), total da conta, botões "Adicionar itens" / "Cancelar pedido" / "Fechar conta".

**Fechar conta:** soma pedidos não-cancelados → confirma → `status='fechada'`,
`fechada_em=now()`, mesa liberada. Não mexe em status de cozinha nem em `pago`. Permite
fechar com pedido ainda em preparo (com aviso visual).

**Bordas:** find-or-create concorrente resolvido pelo índice único parcial; fechar comanda
fechada/vazia bloqueado na UI; cancelar último pedido deixa comanda aberta-vazia.

### ❓ PERGUNTA ABERTA (responder pra fechar o design e escrever o spec)
**Ao "Cancelar pedido" dentro da comanda, o pedido deve sumir do Kanban/cozinha também
(status `cancelado` no sistema todo)?** Recomendação: SIM — cancelar na comanda = cancelar
de vez (status `cancelado`), some do Kanban/cozinha e sai do total. Confirmar.

### Próximos passos Fase 2 (depois da confirmação)
1. Escrever spec `docs/superpowers/specs/YYYY-MM-DD-pdv-comanda-fase2-design.md` (skill brainstorming → writing-plans).
2. Escrever plano de implementação.
3. Implementar via subagent-driven-development. Tasks prováveis:
   - Migration `comandas` + `pedidos.comanda_id` + índice único parcial + RLS.
   - `lib/queries/comandas.ts`: `abrirOuObterComanda`, `buscarComandaAberta(mesa)`,
     `listarPedidosDaComanda`, `cancelarPedidoComanda`, `fecharComanda`, `listarMesasComEstado`
     (mesa + comanda aberta + total).
   - `criarPedido`/route do PDV: linkar comanda_id (find-or-create).
   - UI `/admin/pdv`: grade de mesas com estado ocupado/total; painel da comanda (lista de
     pedidos, cancelar, adicionar, fechar conta).
   - Tag/realtime: total da mesa atualiza quando chega/cancela pedido.
4. Aplicar migration nova no remoto (manual, igual 0033).

---

## ⬜ FASE 3 — Controle de caixa (NÃO INICIADA — só ideia)

Objetivo: ao fechar a mesa, registrar **forma(s) de pagamento** e somar num **fechamento de
caixa do salão por turno/operador** (esperado x declarado x diferença), espelhando o
`fechamentos_caixa` que já existe pra entregador.

**Modelo existente pra espelhar:** `fechamentos_caixa` (`supabase/migrations/0003_pedidos_logistica.sql:100`)
com `valor_esperado`, `troco_levado`, `valor_declarado`, `diferenca`, `fechado_em`; funções
`listarResumoCaixa`/`registrarFechamentoCaixa` em `lib/queries/pedidos.ts:713`.

**Decisões a brainstormar quando chegar a hora (NADA decidido ainda):**
- Pagamento no fechar conta: forma única ou **split** (parte dinheiro + parte cartão/pix)?
- Marca `pedidos.pago=true` + `forma_pagamento` real ao fechar a comanda.
- Conceito de **sessão/turno de caixa**: abrir caixa (fundo de troco) → lançar fechamentos
  de mesa no turno → fechar caixa (conferência esperado x contado x diferença). Por
  operador (usuário) ou por loja?
- Relação com o caixa do entregador (são caixas separados? consolida no dashboard?).
- Onde fica a UI: aba "Caixa" no PDV? Seção nova no menu? Relatório no Dashboard?

**Sequência Fase 3:** brainstorming → spec → plano → subagent-driven-development → aplicar migration.

---

## Como retomar (resumo pro próximo "claude")

1. Ler este arquivo + `CLAUDE.md` + memória (`MEMORY.md` → [[project-pdv-origem-tag]]).
2. Confirmar se a migration `0033` já foi aplicada no remoto (se não, aplicar).
3. Responder a **pergunta aberta da Fase 2** (cancelar pedido = cancelar no sistema?).
4. Fase 2: invocar `superpowers:brainstorming` (já quase pronto — só formalizar spec) →
   `writing-plans` → `subagent-driven-development`.
5. Depois Fase 3: brainstorming do zero (decisões acima) → spec → plano → implementação.
6. Trabalhar direto na `main`, commit+push após cada feature validada (preferência do usuário).
