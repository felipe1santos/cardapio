# PDV (Frente de Caixa / Serviço de Mesa) — Fase 1

**Data:** 2026-06-27
**Status:** Aprovado (aguardando plano de implementação)
**Sub-projeto:** PDV da Menuzia

## Contexto

A Menuzia hoje recebe pedidos por dois caminhos: a vitrine pública (`/loja/[slug]`)
e inserção manual. O lojista quer uma **frente de caixa (PDV)** onde o atendente
lança pedidos **na frente do balcão** e esses pedidos:

1. Caem no Kanban principal (`/admin/pedidos`) em tempo real;
2. Caem também nas cozinhas (`/cozinha/[token]`);
3. Aparecem com uma **tag de origem `PDV`** + o **número da mesa**.

O modelo real é **serviço de mesa**, não caixa puro: o cliente senta, o atendente
lança o pedido informando a mesa, o pedido vai pra cozinha, o cliente come e **paga
no fim ao fechar a mesa**. O pagamento e o fechamento de caixa são fases posteriores.

### Fatiamento (decisão do usuário)

- **Fase 1 (este spec):** Tela PDV + cadastro de mesas + lançamento por mesa que cai
  no Kanban/cozinhas com tag `PDV` + número da mesa.
- **Fase 2 (depois):** Controle de mesas — visão de mesas abertas, agrupando os
  pedidos por mesa, total acumulado, botão "fechar mesa".
- **Fase 3 (depois):** Controle de caixa — formas de pagamento no fechamento,
  conferência/fechamento de caixa por turno.

## Princípio: não quebrar o código existente

Toda a Fase 1 é **aditiva**:

- A migration só **adiciona** colunas (com `default`) e uma tabela nova. Nenhum
  `select`/`insert` atual passa a falhar.
- `criarPedido` ganha campos **opcionais** com default que reproduz o comportamento
  de hoje — a vitrine e a inserção manual continuam idênticas.
- O enum `forma_pagamento` **não muda**. Pedido de mesa nasce com `pago=false`; a
  forma de pagamento real só é gravada no fechamento (Fase 3). O card de um pedido
  PDV mostra "Mesa X · conta aberta" no lugar do badge de forma de pagamento.
- O enum `tipo_pedido` **não muda**. Pedido de mesa usa `tipo='retirada'`, então
  **não** entra na Logística (que só trata `entrega`), fica no Kanban e "Entregue"
  significa "serviu na mesa".

## Modelo de dados

### Migration `0032_pdv_mesas.sql` (idempotente)

```sql
-- Origem do pedido (rastreio de onde veio)
alter table pedidos add column if not exists origem text not null default 'cardapio';
-- valores em uso: 'cardapio' (vitrine/manual) | 'pdv' (frente de caixa)

-- Mesa do pedido PDV (snapshot do nome da mesa no momento do lançamento)
alter table pedidos add column if not exists mesa text;

-- Cadastro de mesas por loja
create table if not exists mesas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,                 -- ex.: "1", "Mesa 1", "Varanda 3"
  ordem int not null default 0,       -- ordenação na grade do PDV
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create index if not exists idx_mesas_restaurante on mesas(restaurante_id);

-- RLS no mesmo padrão das outras tabelas (isolamento por tenant).
alter table mesas enable row level security;
-- policies/grants espelhando o que já existe pra tabelas do tenant
-- (ver migrations anteriores para o padrão exato de policy por restaurante_id).
```

> A aplicação remota segue a observação do projeto: `npm run db:setup` está quebrado;
> aplicar a migration **direto via pg** (DATABASE_URL do `.env.local`) com SQL
> idempotente. Confirmar com o usuário antes de aplicar.

## Componentes (unidades isoladas)

### 1. `lib/queries/mesas.ts` — CRUD de mesas

- `listarMesas(supabase, restauranteId)` → mesas ativas e inativas, ordenadas por `ordem`.
- `listarMesasAtivas(supabase, restauranteId)` → só `ativa=true`, pra grade do PDV.
- `criarMesa(supabase, restauranteId, { nome, ordem })`.
- `atualizarMesa(supabase, id, patch)` (renomear, ativar/desativar, reordenar).
- `removerMesa(supabase, id)`.

Tipo exportado `Mesa { id, nome, ordem, ativa }`.

### 2. Aba "Mesas" em `/admin/ajustes`

CRUD visual simples (lista + adicionar + editar inline + ativar/desativar). Segue o
padrão visual das outras abas de Ajustes (Loja, Entrega, Integrações, Presets).
Não há fluxo novo de auth — usa a sessão admin existente.

### 3. `criarPedido` estendido (`lib/queries/pedidos.ts`)

`NovoPedidoInput` ganha:

```ts
origem?: 'cardapio' | 'pdv'  // default 'cardapio'
mesa?: string                // só usado quando origem === 'pdv'
```

No `insert` da tabela `pedidos`, gravar:

```ts
origem: input.origem ?? 'cardapio',
mesa: input.origem === 'pdv' ? (input.mesa ?? null) : null,
```

Nada mais muda na função: ela continua recalculando preços do banco. A vitrine não
passa `origem` → cai no default `'cardapio'` → comportamento idêntico ao de hoje.

### 4. Tela PDV — `/admin/pdv`

- Item novo na sidebar (`app/admin/layout.tsx` → `NAV_ITEMS`, com ícone em
  `NAV_ICONS`). Posição: após "Painel de Pedidos" (faz par com o fluxo de cozinha).
- Abre em **focus-mode**: dispara `menuzia:focus-mode` (mecanismo que o Kanban já
  usa) pra esconder a sidebar e dar tela cheia de caixa.
- **Fonte Inter + paleta Menuzia** (padrão do app, já é a mesma fonte do painel de
  despacho de rotas). Radius 3px, badges/botões do design system.

Layout em 3 áreas:

- **Mesas** (esquerda): grade das mesas ativas (de `listarMesasAtivas`) + botão
  **"Balcão"** (mesa = null). Selecionar define a mesa do pedido em montagem.
- **Cardápio** (centro): busca + chips de categoria; clicar num item adiciona à
  comanda. Itens com complementos/tamanho/sabor/pizza abrem o **mesmo seletor da
  vitrine** (reusar/adaptar o componente de detalhe do produto de `/loja/[slug]`
  pra não duplicar a lógica de montagem de `NovoPedidoItemInput`).
- **Comanda** (direita): itens escolhidos, quantidade (stepper), subtotal/total, e
  botão **"Lançar na cozinha"**.

Ao lançar: monta `NovoPedidoInput` com `tipo='retirada'`, `origem='pdv'`,
`mesa` (nome da mesa selecionada, ou `undefined` se Balcão), `cliente` opcional
(nome vazio → `"Cliente Balcão"`, telefone vazio), `pagamento` placeholder
(insere com `pago=false`; forma real fica pra Fase 3), `itens` montados. Chama
`criarPedido` via uma **server action / route** (mesmo caminho service_role que a
vitrine usa — PDV é admin autenticado, então pode ser uma route `/api/admin/pdv/pedido`
ou server action que valida a sessão e o `restaurante_id` do usuário).

Após sucesso: limpa a comanda, mantém a tela pronta pro próximo lançamento, feedback
visual (toast "Pedido #N lançado na Mesa X").

### 5. Tag de origem nos cards

Renderizar quando `pedido.origem === 'pdv'`:

- **Kanban** (`app/admin/pedidos/page.tsx`): badge `PDV` + chip `Mesa X` no card.
- **Cozinhas** (`app/cozinha/[token]/page.tsx`): mesma tag no card.
- Tipo `Pedido` (e o tipo usado na cozinha) ganham `origem` e `mesa` nos selects
  correspondentes (`listarPedidosKanban`, query da cozinha, etc.).
- Vitrine **continua sem tag** (decisão do usuário: só PDV é marcado).
- Onde hoje o card mostra forma de pagamento, para `origem==='pdv'` mostrar
  "Mesa X · conta aberta" (sem badge de pagamento, já que paga no fim).

### 6. CLAUDE.md — lembrete fixo de paleta/fonte

Adicionar no início da seção 3 (Design System) uma nota destacada:

> **⚠️ Paleta e fonte oficiais — sempre seguir.** A paleta de cores abaixo e a fonte
> **Inter** (mesma usada no painel de despacho de rotas) são o padrão oficial da
> Menuzia. Toda alteração visual em qualquer módulo (incluindo o PDV) deve usar
> exatamente estas cores, a fonte Inter e o radius 3px — sem introduzir cores ou
> fontes fora desta paleta.

## Fluxo de dados (tempo real)

```
Atendente no PDV (/admin/pdv)
   → seleciona mesa + monta comanda
   → "Lançar na cozinha"
   → criarPedido(origem='pdv', mesa, tipo='retirada', pago=false)
   → INSERT em pedidos (status='recebido')
        ├─→ Kanban (/admin/pedidos)  [realtime: canal pedidos já existe]  → card com tag PDV + Mesa
        └─→ Cozinhas (/cozinha/[token]) [mesmo realtime]                  → card com tag PDV + Mesa
```

Nenhum código novo de realtime: o canal Supabase que o Kanban e as cozinhas já
assinam dispara no `INSERT`. A tag aparece porque o select passa a trazer `origem`/`mesa`.

## Tratamento de erros

- Lançar comanda vazia → bloqueado na UI ("Adicione itens à comanda").
- Item indisponível no momento do lançamento → `criarPedido` já lança erro
  ("Item X não está disponível"); exibir como toast de erro, manter a comanda.
- Mesa não selecionada e botão Balcão não marcado → exigir escolha antes de lançar
  (ou default Balcão — decidir no plano; recomendação: exigir escolha explícita).

## Testes

- `lib/queries/mesas.ts`: unidade do CRUD (mock supabase) — listar ativas ordena por
  `ordem`, criar/atualizar/remover.
- `criarPedido`: caso `origem='pdv'` grava `origem`/`mesa` e `pago=false`; caso sem
  `origem` mantém `'cardapio'` e `mesa=null` (regressão da vitrine).
- Verificação manual no ambiente real (Coolify): lançar pedido de mesa no PDV e
  confirmar que aparece no Kanban e na cozinha com a tag — o sandbox bloqueia rede
  pro Supabase, então teste de navegador automatizado não roda aqui (padrão do projeto).

## Fora de escopo (Fases 2/3)

- Fechar mesa / agrupar pedidos da mesma mesa.
- Total acumulado por mesa / visão de mesas abertas.
- Forma de pagamento no fechamento, troco, controle/fechamento de caixa.
- Tag `Manual` para inserção manual (só `PDV` por enquanto).
