# Sistema de Fidelidade + Cupons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin cria campanhas de fidelidade (metas de gasto/pedidos/itens) e cupons; cliente acompanha progresso na vitrine (aba Cupons), recebe WhatsApp a cada pedido ENTREGUE que soma, e resgata prêmios (item grátis, % desconto, valor fixo, entrega grátis) — com som/piscar gamificado e banner amarelo acima dos Destaques.

**Architecture:** Novas tabelas multi-tenant (campanhas_fidelidade, fidelidade_progresso, fidelidade_recompensas, cupons, cupom_usos) + colunas em pedidos (cupom_codigo, desconto, recompensa_id, fidelidade_processado). Motor de progresso server-side idempotente disparado SOMENTE quando pedido vira `entregue` (3 caminhos existentes). Validação de cupom/recompensa e cálculo de desconto são server-authoritative em `criarPedido`. Regras puras testáveis em `lib/fidelidade-regras.ts` (vitest). WhatsApp via `enviarWhatsapp` (Evolution API, lib/whatsapp.ts:87) — best-effort.

**Tech Stack:** Next.js App Router, Supabase (service role nas rotas server), vitest, Evolution API (WhatsApp), Tailwind (design system Menuzia: radius 3px, Inter, --primary #0688D4).

## Global Constraints

- Multi-tenant: TODA tabela nova tem `restaurante_id` + RLS tenant-scoped (padrão migration 0021_campanhas).
- Migration nova = `supabase/migrations/0041_fidelidade.sql` (última atual: 0040).
- **Só pedido `entregue` conta** progresso — e só 1x (flag `fidelidade_processado`).
- Progresso conta **subtotal** (produtos, sem taxa de entrega).
- Cliente identificado por `cliente_telefone` normalizado (padrão clientes_vitrine 0013); pedidos sem telefone não contam. Pedidos origem `pdv` NÃO contam.
- Desconto server-authoritative: cliente manda `cupomCodigo`/`recompensaId`, servidor valida e calcula; nunca confiar em valor do client.
- Visual: paleta Menuzia, radius 3px, Inter, botões caixa alta 11px. Banner de prêmio = amarelo (`--warn #F59E0B` / `--bg-warn #FEF3C7`).
- WhatsApp fire-and-forget com `.catch` — nunca quebra o fluxo do pedido (padrão notificarPedido).
- Commits frequentes por task, push só ao final de cada fase validada.

## Referências do codebase (mapeado 2026-07-14)

| O quê | Onde |
|---|---|
| Menu admin | `app/admin/layout.tsx:11` NAV_ITEMS `{href,label,badge?,novidade?}`; ícones `components/layout/sidebar.tsx:17` NAV_ICONS |
| Auth admin API | `getAuthSupabase()` + `buscarRestauranteIdDoUsuario()` (padrão app/api/admin/campanhas/route.ts:14-26) |
| Padrão CRUD admin | app/admin/campanhas/page.tsx (drawer direita, fetch /api/admin/*) |
| Pedido → entregue (3 caminhos server) | `app/api/entregador/[token]/pedidos/[id]/entregar/route.ts:15`; `app/api/cozinha/[token]/pedidos/[id]/acao/route.ts:63`; painel via `lib/notificar.ts` → `app/api/pedidos/[id]/notificar/route.ts:30` |
| Transições | `marcarPedidoEntregue` (lib/queries/pedidos.ts:433), `marcarEntregaConcluida` (:515) — chamadas client-side pelo painel, por isso o hook de fidelidade fica nas API routes acima |
| WhatsApp | `enviarWhatsapp(numero, texto, instance)` lib/whatsapp.ts:87; instance em `restaurantes.evolution_instance` |
| Vitrine abas | `type Tab` page.tsx:54; bottom nav :1852-1882; aba 'cupons' é placeholder "em breve" :1825-1835 |
| Destaques (banner vai ACIMA) | page.tsx:1446 |
| Checkout totais | subtotal :470, fee :503, total :506; payload POST pedido :1132-1154; `NovoPedidoInput` lib/queries/pedidos.ts:793 |
| Conta cliente | clienteSessao {telefone,token} :620; GET/PATCH /api/loja/[slug]/conta |
| Polling meus pedidos (detecta entregue) | page.tsx:1058-1090 (8s) |
| Segmentação existente (reusar semântica) | `FiltroCampanha` lib/queries/campanhas.ts:10 (dias_inativo etc.) |

---

## FASE 1 — Fundação: migration + regras puras + queries

### Task 1: Migration 0041_fidelidade.sql

**Files:**
- Create: `supabase/migrations/0041_fidelidade.sql`

**Produces:** tabelas `campanhas_fidelidade`, `fidelidade_progresso`, `fidelidade_recompensas`, `cupons`, `cupom_usos`; colunas novas em `pedidos`.

```sql
-- Campanhas de fidelidade: metas que o cliente completa pra ganhar prêmio.
create table campanhas_fidelidade (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,
  descricao text not null default '',
  ativa boolean not null default true,
  -- Meta: o que o cliente precisa acumular (pedidos entregues contam).
  tipo_meta text not null check (tipo_meta in ('valor_gasto', 'qtd_pedidos', 'qtd_itens')),
  meta_valor numeric(10,2), -- alvo em R$ quando tipo_meta = valor_gasto
  meta_quantidade integer,  -- alvo qtd quando qtd_pedidos/qtd_itens
  -- Dias da semana em que pedidos CONTAM pro progresso (0=dom..6=sab). Vazio = todos.
  dias_semana_contam smallint[] not null default '{}',
  -- Dias da semana em que o prêmio pode ser RESGATADO. Vazio = qualquer dia.
  dias_semana_resgate smallint[] not null default '{}',
  -- Prêmio
  premio_tipo text not null check (premio_tipo in ('item_gratis', 'desconto_percentual', 'desconto_valor', 'entrega_gratis')),
  premio_item_id uuid references itens(id) on delete set null,
  premio_valor numeric(10,2), -- % ou R$ conforme premio_tipo
  -- true = cliente pode completar de novo depois de ganhar; false = uma única vez.
  repetivel boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Progresso de cada cliente em cada campanha.
create table fidelidade_progresso (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  campanha_id uuid not null references campanhas_fidelidade(id) on delete cascade,
  cliente_telefone text not null,
  progresso_valor numeric(10,2) not null default 0,
  progresso_qtd integer not null default 0,
  ciclos_completados integer not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (campanha_id, cliente_telefone)
);

-- Prêmios ganhos, prontos pra resgatar (aparecem na aba Cupons da vitrine).
create table fidelidade_recompensas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  campanha_id uuid not null references campanhas_fidelidade(id) on delete cascade,
  cliente_telefone text not null,
  status text not null default 'disponivel' check (status in ('disponivel', 'resgatado', 'cancelado')),
  pedido_resgate_id uuid references pedidos(id) on delete set null,
  ganho_em timestamptz not null default now(),
  resgatado_em timestamptz
);
create index idx_fidelidade_recompensas_cliente on fidelidade_recompensas (restaurante_id, cliente_telefone, status);

-- Cupons de código criados pelo admin (desconto %, valor, entrega grátis, item grátis).
create table cupons (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  codigo text not null,
  descricao text not null default '',
  ativo boolean not null default true,
  tipo text not null check (tipo in ('desconto_percentual', 'desconto_valor', 'entrega_gratis', 'item_gratis')),
  valor numeric(10,2),
  item_id uuid references itens(id) on delete set null,
  -- Público: todos | primeira_compra (nunca pediu) | recompra (só 1 pedido OU inativo há X dias)
  publico text not null default 'todos' check (publico in ('todos', 'primeira_compra', 'recompra')),
  dias_inatividade integer, -- usado quando publico = recompra
  -- Dias da semana em que o cupom vale (ex.: batata grátis na quarta). Vazio = todos.
  dias_semana smallint[] not null default '{}',
  validade_inicio date,
  validade_fim date,
  valor_minimo_pedido numeric(10,2), -- subtotal mínimo pra aplicar. null = sem mínimo
  uso_unico_por_cliente boolean not null default true,
  max_usos integer, -- teto global. null = ilimitado
  usos integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (restaurante_id, codigo)
);

-- Registro de uso de cupom (trava uso único por cliente).
create table cupom_usos (
  id uuid primary key default gen_random_uuid(),
  cupom_id uuid not null references cupons(id) on delete cascade,
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  cliente_telefone text not null,
  pedido_id uuid not null references pedidos(id) on delete cascade,
  usado_em timestamptz not null default now()
);
create index idx_cupom_usos_cliente on cupom_usos (cupom_id, cliente_telefone);

-- Pedido: desconto aplicado + vínculos + idempotência do motor de fidelidade.
alter table pedidos add column cupom_codigo text;
alter table pedidos add column desconto numeric(10,2) not null default 0;
alter table pedidos add column recompensa_id uuid references fidelidade_recompensas(id) on delete set null;
alter table pedidos add column fidelidade_processado boolean not null default false;

-- RLS tenant-scoped (mesmo padrão de campanhas / 0021)
alter table campanhas_fidelidade enable row level security;
alter table fidelidade_progresso enable row level security;
alter table fidelidade_recompensas enable row level security;
alter table cupons enable row level security;
alter table cupom_usos enable row level security;

create policy campanhas_fidelidade_tenant on campanhas_fidelidade for all
  using (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()))
  with check (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()));
create policy fidelidade_progresso_tenant on fidelidade_progresso for all
  using (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()))
  with check (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()));
create policy fidelidade_recompensas_tenant on fidelidade_recompensas for all
  using (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()))
  with check (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()));
create policy cupons_tenant on cupons for all
  using (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()))
  with check (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()));
create policy cupom_usos_tenant on cupom_usos for all
  using (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()))
  with check (restaurante_id = (select restaurante_id from usuarios where id = auth.uid()));
```

> ⚠️ Antes de escrever, CONFERIR o padrão exato de policy RLS em `supabase/migrations/0021_campanhas.sql` e replicar (nome da tabela de usuários/claim pode diferir). Aplicar no remoto do mesmo jeito que as migrations 0034/0037 foram aplicadas (ver docs/memória: aplicação via pg direto).

**Steps:**
- [ ] Escrever migration (conferindo padrão RLS do 0021)
- [ ] Aplicar no banco remoto (mesmo método das migrations anteriores)
- [ ] Verificar: `select * from campanhas_fidelidade limit 1` sem erro; colunas novas em pedidos existem
- [ ] Commit `feat(fidelidade): schema de campanhas, progresso, recompensas e cupons (migration 0041)`

### Task 2: Regras puras + testes (`lib/fidelidade-regras.ts`)

**Files:**
- Create: `lib/fidelidade-regras.ts`
- Test: `lib/fidelidade-regras.test.ts`

**Interfaces (Produces):**
```ts
export interface CampanhaFidelidade {
  id: string; nome: string; descricao: string; ativa: boolean
  tipoMeta: 'valor_gasto' | 'qtd_pedidos' | 'qtd_itens'
  metaValor: number | null; metaQuantidade: number | null
  diasSemanaContam: number[]; diasSemanaResgate: number[]
  premioTipo: 'item_gratis' | 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis'
  premioItemId: string | null; premioValor: number | null
  repetivel: boolean
}
export interface ProgressoCliente { progressoValor: number; progressoQtd: number; ciclosCompletados: number }

/** Pedido entregue conta pra campanha? (dia da semana + campanha ativa + repetição) */
export function pedidoContaParaCampanha(c: CampanhaFidelidade, p: ProgressoCliente, diaSemanaPedido: number): boolean

/** Aplica um pedido ao progresso. Retorna novo progresso + se completou a meta agora. */
export function aplicarPedidoAoProgresso(
  c: CampanhaFidelidade, p: ProgressoCliente,
  pedido: { subtotal: number; qtdItens: number }
): { novo: ProgressoCliente; completou: boolean }

/** Quanto falta (texto pro WhatsApp/vitrine): {faltaTexto, percentual} */
export function resumoProgresso(c: CampanhaFidelidade, p: ProgressoCliente): { faltaTexto: string; percentual: number }

/** Hoje pode resgatar? (dias_semana_resgate) */
export function podeResgatarHoje(diasSemanaResgate: number[], diaSemanaHoje: number): boolean

export interface CupomRegra {
  ativo: boolean; tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis'
  valor: number | null; publico: 'todos' | 'primeira_compra' | 'recompra'
  diasInatividade: number | null; diasSemana: number[]
  validadeInicio: string | null; validadeFim: string | null
  valorMinimoPedido: number | null; usoUnicoPorCliente: boolean
  maxUsos: number | null; usos: number
}
export interface HistoricoCliente { totalPedidosEntregues: number; ultimoPedidoEm: string | null; jaUsouEsteCupom: boolean }

/** Valida cupom pro cliente/momento. Retorna {ok:true} ou {ok:false, motivo}. */
export function validarCupom(
  cupom: CupomRegra, hist: HistoricoCliente,
  ctx: { subtotal: number; diaSemana: number; hojeISO: string }
): { ok: true } | { ok: false; motivo: string }

/** Desconto em R$ de um cupom/prêmio sobre subtotal+frete. Nunca negativo, nunca > subtotal. */
export function calcularDesconto(
  tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis',
  valor: number | null, subtotal: number, taxaEntrega: number
): { descontoSubtotal: number; zeraFrete: boolean }
```

Casos de teste obrigatórios (vitest, TDD — escrever antes da implementação):
- valor_gasto: soma subtotal; completa exatamente na meta; excedente NÃO transborda pro próximo ciclo (zera).
- qtd_pedidos: +1 por pedido; dias_semana_contam=[3] só conta pedido de quarta.
- qtd_itens: soma qtdItens do pedido.
- repetivel=false + ciclosCompletados>=1 → pedidoContaParaCampanha = false.
- repetivel=true → completou → progresso zera, ciclos+1.
- resumoProgresso: "Faltam R$ 25,00", "Faltam 2 pedidos", "Falta 1 item"; percentual 0-100 clamp.
- podeResgatarHoje: vazio = sempre; [3] só quarta.
- validarCupom: inativo; fora do dia da semana; fora da validade; subtotal < mínimo; publico primeira_compra com totalPedidosEntregues>0 → recusa; publico recompra exige (totalPedidosEntregues<=1 OU ultimoPedidoEm mais antigo que diasInatividade); uso único já usado → recusa; maxUsos atingido → recusa.
- calcularDesconto: percentual arredonda 2 casas; desconto_valor > subtotal trava no subtotal; entrega_gratis → zeraFrete true, descontoSubtotal 0; item_gratis → 0/false (item entra como linha R$ 0, não desconto).

**Steps:**
- [ ] Escrever testes (falhando)
- [ ] `npx vitest run lib/fidelidade-regras.test.ts` → FAIL
- [ ] Implementar regras
- [ ] `npx vitest run lib/fidelidade-regras.test.ts` → PASS
- [ ] Commit `feat(fidelidade): regras puras de progresso e validação de cupom (TDD)`

### Task 3: Queries (`lib/queries/fidelidade.ts`)

**Files:**
- Create: `lib/queries/fidelidade.ts`

**Interfaces (Produces):** (todas recebem `admin: SupabaseClient` service-role; mapeiam snake_case→camelCase como lib/queries/clientes.ts)
```ts
// Admin CRUD
listarCampanhasFidelidade(admin, restauranteId): Promise<CampanhaFidelidadeComStats[]> // + contadores: clientes em progresso, recompensas ganhas/resgatadas
criarCampanhaFidelidade(admin, restauranteId, input: CampanhaFidelidadeInput): Promise<CampanhaFidelidade>
atualizarCampanhaFidelidade(admin, restauranteId, id, input): Promise<CampanhaFidelidade>
excluirCampanhaFidelidade(admin, restauranteId, id): Promise<void>
listarCupons(admin, restauranteId): Promise<CupomComStats[]>
criarCupom(admin, restauranteId, input: CupomInput): Promise<Cupom>
atualizarCupom(admin, restauranteId, id, input): Promise<Cupom>
excluirCupom(admin, restauranteId, id): Promise<void>

// Vitrine
buscarFidelidadeCliente(admin, restauranteId, telefone): Promise<{
  campanhas: { campanha: CampanhaFidelidade & { premioItemNome?, premioItemImagemUrl? }; progresso: ProgressoCliente; resumo: {faltaTexto, percentual} }[]
  recompensas: RecompensaDisponivel[] // com nome/imagem do item prêmio
  cuponsPublicos: CupomVitrine[]      // ativos, válidos hoje, sem código exposto? NÃO — código exposto sim, cliente precisa dele
}>

// Motor
processarFidelidadePedidoEntregue(admin, pedidoId): Promise<void> // Task 4 detalha
buscarHistoricoCliente(admin, restauranteId, telefone): Promise<HistoricoCliente + jaUsouCupom(cupomId)>
```

Validação de input no servidor (padrão campanhas): nome obrigatório, meta > 0 conforme tipo, premio_valor obrigatório p/ descontos, premio_item_id obrigatório p/ item_gratis, codigo de cupom uppercase sem espaços.

**Steps:**
- [ ] Implementar queries com tipos
- [ ] `npx tsc --noEmit` limpo (fora erros pré-existentes de .test)
- [ ] Commit `feat(fidelidade): camada de queries admin/vitrine/motor`

---

## FASE 2 — Motor de progresso + WhatsApp

### Task 4: `processarFidelidadePedidoEntregue` + hooks nos 3 caminhos de entrega

**Files:**
- Create: `lib/fidelidade.ts` (motor, usa regras da Task 2 + queries da Task 3 + `enviarWhatsapp`)
- Modify: `app/api/entregador/[token]/pedidos/[id]/entregar/route.ts` (após marcarEntregaConcluida)
- Modify: `app/api/cozinha/[token]/pedidos/[id]/acao/route.ts` (após acao='entregue')
- Modify: `app/api/pedidos/[id]/notificar/route.ts` (quando status==='entregue' — cobre kanban/logística que marcam entregue client-side e chamam notificar)

**Comportamento do motor (idempotente):**
1. `update pedidos set fidelidade_processado = true where id = :id and status = 'entregue' and fidelidade_processado = false returning *` — 0 rows → já processado/não entregue, retorna.
2. Pedido sem `cliente_telefone` ou `origem = 'pdv'` → retorna.
3. Se `pedido.recompensa_id` → confirma recompensa `resgatado` (já feito no criarPedido; aqui é no-op de segurança).
4. Busca campanhas ativas da loja. Para cada uma: `pedidoContaParaCampanha` (dia da semana do `criado_em` do pedido, timezone America/Sao_Paulo) → `aplicarPedidoAoProgresso` → upsert progresso.
5. Completou? → insert `fidelidade_recompensas` (disponivel) + WhatsApp "🎉 Você ganhou {prêmio}! {quando resgatar}". Não completou mas progrediu? → WhatsApp "Pedido entregue! ✅ {resumoProgresso.faltaTexto} para ganhar {prêmio} ({X/Y})".
6. Máx 1 mensagem WhatsApp por pedido: se várias campanhas progrediram, agrupar numa mensagem só (lista).
7. Tudo em try/catch com log — nunca propaga erro pro endpoint.

Mensagens (montar em `montarMensagemFidelidade(progressos, recompensasNovas, nomeLoja): string | null`, exportada e testada em `lib/fidelidade-regras.test.ts`):
```
Pedido entregue! ✅

Seu progresso de fidelidade na {loja}:
• Faltam 2 pedidos para ganhar 1 X-Tudo (8/10)
• Faltam R$ 25,00 para ganhar 10% de desconto

🎉 PRÊMIO DESBLOQUEADO: Batata Frita grátis!
Resgate na aba Cupons do cardápio (válido às quartas).
```

**Steps:**
- [ ] Testes das funções de mensagem/agrupamento (vitest) → FAIL → implementar → PASS
- [ ] Implementar motor + hooks (fire-and-forget `.catch(console.error)` nos 3 endpoints)
- [ ] Teste manual: marcar pedido entregue no banco de dev → conferir progresso/recompensa criados e log de WhatsApp
- [ ] `npx tsc --noEmit` + `npx vitest run` limpos
- [ ] Commit `feat(fidelidade): motor de progresso em pedido entregue + notificação WhatsApp`

### Task 5: Reversão em cancelamento

**Files:**
- Modify: ponto de cancelamento de pedido (localizar: `avancarStatusPedido(status='cancelado')` callers + app/api/admin/pdv/pedido/[id]/cancelar/route.ts)

Pedido cancelado que tinha `recompensa_id` → recompensa volta pra `disponivel` (`pedido_resgate_id = null, resgatado_em = null`). Cupom usado → deletar linha de `cupom_usos` + decrementar `usos`. (Progresso não reverte: só conta em entregue, e entregue→cancelado não existe no fluxo.)

**Steps:**
- [ ] Implementar reversão via função `reverterBeneficiosPedidoCancelado(admin, pedidoId)` em lib/fidelidade.ts, chamada nos pontos de cancelamento server-side
- [ ] Commit `feat(fidelidade): devolve recompensa/cupom quando pedido é cancelado`

---

## FASE 3 — Painel admin "Fidelidade"

### Task 6: API admin

**Files:**
- Create: `app/api/admin/fidelidade/campanhas/route.ts` (GET lista, POST cria)
- Create: `app/api/admin/fidelidade/campanhas/[id]/route.ts` (PATCH, DELETE)
- Create: `app/api/admin/fidelidade/cupons/route.ts` (GET, POST)
- Create: `app/api/admin/fidelidade/cupons/[id]/route.ts` (PATCH, DELETE)

Auth: mesmo padrão de `app/api/admin/campanhas/route.ts:14-26` (`getAuthSupabase` + `buscarRestauranteIdDoUsuario`, 401 se null). Erros de validação → 400 com `{error}`.

**Steps:**
- [ ] Implementar rotas chamando queries da Task 3
- [ ] Smoke test com curl/fetch autenticado (ou via página na Task 7)
- [ ] Commit `feat(fidelidade): API admin de campanhas e cupons`

### Task 7: Página `app/admin/fidelidade/page.tsx` + menu

**Files:**
- Create: `app/admin/fidelidade/page.tsx`
- Modify: `app/admin/layout.tsx:11` (NAV_ITEMS: `{ href: '/admin/fidelidade', label: 'Fidelidade', novidade: true }` — posição depois de Campanhas)
- Modify: `components/layout/sidebar.tsx:17` (NAV_ICONS: ícone presente/troféu SVG path)

Layout (padrão campanhas/page.tsx — 'use client', drawer direita):
- Duas abas internas: **Campanhas de fidelidade** | **Cupons**.
- Campanhas: tabela (nome, meta legível "R$ 200 gastos" / "10 pedidos às quartas", prêmio com thumb do item, resgate "só quartas", repetível sim/não, ativa toggle, stats: clientes progredindo / prêmios ganhos / resgatados) + drawer criar/editar com: nome, descrição, tipo_meta (select 3), meta (input), dias que contam (chips D S T Q Q S S), dias de resgate (chips), prêmio (select 4 tipos; item_gratis abre busca de item do cardápio com foto; descontos abrem input valor/%), repetível (toggle), ativa.
- Cupons: tabela (código, tipo/valor, público, dias, validade, usos/max, ativo) + drawer: código (uppercase auto), descrição, tipo (4), valor, item (se item_gratis), público (todos/primeira compra/recompra + dias inatividade), dias da semana, validade início/fim, mínimo do pedido, uso único por cliente, max usos, ativo. Preset visível "Compre de novo" (botão que pré-preenche: publico=recompra, dias_inatividade=30, desconto 10%).
- Seletor de item: reusar padrão existente de busca de itens se houver (conferir em app/admin/campanhas ou cardapio) — senão select simples com busca client-side de GET itens.

**Steps:**
- [ ] Implementar página + menu + ícone
- [ ] Verificar no browser: criar campanha e cupom reais, editar, excluir, toggle ativa
- [ ] `npx next build` OK
- [ ] Commit `feat(fidelidade): página admin com CRUD de campanhas e cupons + item no menu`

---

## FASE 4 — Server: cupom/recompensa no pedido

### Task 8: API vitrine fidelidade + validação de cupom

**Files:**
- Create: `app/api/loja/[slug]/fidelidade/route.ts` — GET `?telefone&token`: valida sessão do cliente (mesmo check de /conta), retorna `buscarFidelidadeCliente` (campanhas+progresso+recompensas+cupons públicos). Sem sessão → só `cuponsPublicos`.
- Create: `app/api/loja/[slug]/cupom/validar/route.ts` — POST `{codigo, telefone?, token?, subtotal}`: retorna `{ok, motivo?, cupom: {tipo, valor, descricao, itemNome?}}` (pré-validação pro checkout mostrar desconto antes de enviar).

**Steps:**
- [ ] Implementar + smoke test
- [ ] Commit `feat(fidelidade): endpoints da vitrine (progresso do cliente + validar cupom)`

### Task 9: `criarPedido` aceita cupom/recompensa (server-authoritative)

**Files:**
- Modify: `lib/queries/pedidos.ts` (`NovoPedidoInput` :793 + `criarPedido`)
- Test: ampliar teste existente de pedidos se houver; senão testes das funções puras já cobrem regras

`NovoPedidoInput` ganha `cupomCodigo?: string` e `recompensaId?: string` (mutuamente exclusivos — se vierem os dois, erro 400).

Dentro de `criarPedido` (transação lógica):
1. Cupom: busca por codigo+restaurante, `buscarHistoricoCliente`, `validarCupom` → recusa com mensagem clara. `calcularDesconto` → grava `desconto`, zera `taxa_entrega` se entrega_gratis, insere linha de item R$ 0 se item_gratis (nome com sufixo "— Cupom {codigo}"). Insert `cupom_usos` + increment `usos`.
2. Recompensa: busca por id, confere `status='disponivel'`, `cliente_telefone` = telefone do pedido, `podeResgatarHoje` (dias_semana_resgate da campanha) → aplica prêmio igual cupom → `status='resgatado', pedido_resgate_id, resgatado_em`.
3. `total = subtotal - desconto + taxa_entrega` (nunca negativo).
4. Race de max_usos/uso único: aceitável otimista (volume baixo por loja); increment com `update ... where usos < max_usos returning` pra não estourar teto.

**Steps:**
- [ ] Testes de integração leves (se padrão do repo permitir) ou verificação manual com pedidos reais em dev
- [ ] `npx vitest run` + `npx tsc --noEmit` limpos
- [ ] Commit `feat(fidelidade): criarPedido valida e aplica cupom/recompensa com desconto server-side`

---

## FASE 5 — Vitrine (cliente)

### Task 10: Aba Cupons real + banner amarelo + som/piscar

**Files:**
- Modify: `app/loja/[slug]/page.tsx`

1. **Estado fidelidade**: fetch GET `/api/loja/[slug]/fidelidade` no load (e re-fetch quando polling de pedidos detectar transição para `entregue`). Estados: `fidelidade: {campanhas, recompensas, cuponsPublicos} | null`.
2. **Aba Cupons** (substituir placeholder :1825-1835), 3 blocos:
   - **Prêmios prontos** (recompensas disponivel): card com FOTO GRANDE do item prêmio (ProductThumb), nome, "resgate às quartas" quando restrito, botão "USAR NO PEDIDO" (verde) → guarda `recompensaSelecionada` e vai pro carrinho. Desabilitado com aviso se hoje não é dia de resgate.
   - **Suas missões** (campanhas em progresso): card com imagem do prêmio, nome da campanha, barra de progresso (verde --status-ready), "8/10 pedidos" ou "R$ 175 / R$ 200", dias que contam quando restrito.
   - **Cupons da loja** (cuponsPublicos): código em destaque tracejado, descrição, botão "APLICAR" → preenche cupom no checkout.
   - Cliente não logado: mostra cupons públicos + CTA "Entre pra ver seu progresso" (abre modal conta).
3. **Banner amarelo único acima dos Destaques** (inserir antes de page.tsx:1446): só quando `recompensas.length + cuponsPublicosAplicaveis > 0` — retângulo `bg-warn-bg border border-warn`, ícone 🎁, texto agregado: "Você tem 2 prêmios e 1 cupom pra resgatar →" (singular/plural correto), clique → `setTab('cupons')`. UM retângulo só, nunca N.
4. **Som + piscar**: quando re-fetch pós-entrega retornar progresso maior que o anterior (comparar com snapshot em localStorage `menuzia_fidelidade_${slug}`) ou recompensa nova → tocar som de sucesso (Web Audio API: 2 osciladores, acorde curto "coin/success", ~0.3s, sem asset externo, respeitando gesto prévio do usuário — se AudioContext bloqueado, ignora) + classe CSS no botão Cupons do bottom nav que pisca 3x (keyframes opacity/scale, 3 iterações) + badge numérico no ícone.
5. **Checkout**: passo 1 (pagamento) ou revisão ganha bloco "Cupom / Prêmio": input de código + botão validar (POST /cupom/validar) mostrando desconto em verde; ou chip da recompensa selecionada (com X pra remover). Resumo: linha "Desconto −R$ X" verde + frete "Grátis" quando aplicável. Payload do POST pedido ganha `cupomCodigo`/`recompensaId`. Erro do servidor (cupom inválido) → mostra motivo e não envia.

**Steps:**
- [ ] Implementar (pode dividir em 2 subagentes: aba cupons+banner; checkout+som)
- [ ] Testar no browser (dev): fluxo completo — criar campanha no admin, fazer pedido, marcar entregue, ver som/piscar/banner/progresso, resgatar prêmio em novo pedido, conferir desconto no kanban/recibo
- [ ] `npx next build` OK
- [ ] Commit `feat(vitrine): aba cupons com missões e prêmios, banner de resgate, som e destaque gamificado`

---

## FASE 6 — Verificação final

### Task 11: E2E + regressão + push

- [ ] `npx vitest run` — tudo verde (exceto falha pré-existente app/page.test.tsx)
- [ ] `npx tsc --noEmit` — sem erros novos
- [ ] `npx next build` — OK
- [ ] Fluxo e2e manual no browser (roteiro): admin cria campanha "10 pedidos → X-Tudo grátis, resgate qualquer dia, repetível" + cupom "VOLTE10 recompra 30d 10%" → cliente pede → entregar → WhatsApp logado/enviado → progresso na vitrine + som + banner → completar meta (ajustar meta pra 1 em teste) → recompensa aparece com foto → resgatar em pedido novo → desconto correto no pedido do kanban → cancelar pedido → recompensa volta.
- [ ] Kanban/logística/dashboard continuam funcionando (desconto aparece no total; nada quebrou)
- [ ] Atualizar memória (`project_fidelidade.md` + MEMORY.md)
- [ ] Push pra main (deploy Coolify)

## Fora de escopo (anotar, não fazer agora)
- Notificação push/web; expiração automática de recompensas; múltiplos cupons por pedido; cupom no PDV; relatório de ROI de fidelidade no dashboard; imagem do prêmio na mensagem do WhatsApp (usar `enviarMidia` — fácil de adicionar depois).
