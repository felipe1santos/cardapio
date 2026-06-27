# PDV Fase 2 — Comanda de Mesa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agrupar os pedidos de uma mesa numa comanda, mostrar total acumulado, permitir cancelar pedido e fechar a conta — tudo dentro de `/admin/pdv`.

**Architecture:** Nova tabela `comandas` (1 aberta por mesa, garantida por índice único parcial) + coluna `pedidos.comanda_id`. Camada `lib/queries/comandas.ts` espelha o estilo de `mesas.ts`. A route do PDV resolve `mesaId` → find-or-create da comanda → liga `comanda_id` no pedido. A tela `/admin/pdv` ganha estado de mesa (ocupada/total) e um painel de comanda (lista de pedidos, cancelar, fechar conta). Pagamento/caixa fica para a Fase 3.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres + RLS), Tailwind, Vitest.

## Global Constraints

- **Trabalhar direto na `main`.** Deploy é Coolify lendo main. Commit + push após cada feature validada.
- **Migrations:** `npm run db:setup` está QUEBRADO. Toda migration nova é aplicada manualmente no SQL editor do Supabase remoto. SQL deve ser idempotente (`if not exists` / `add column if not exists`).
- **RLS multi-tenant:** toda tabela do tenant usa `restaurante_id = auth_restaurante_id()` em policy `for all` + `grant ... to authenticated`. Padrão exato em `supabase/migrations/0033_pdv_mesas.sql:21-30`.
- **Design system Menuzia:** fonte Inter, radius `3px` (classe `rounded-menuzia`), paleta oficial (ver `CLAUDE.md` seção 3). Botões caixa alta. Não introduzir cores/fontes fora da paleta.
- **Aditivo, vitrine intacta:** nada nesta fase pode alterar o comportamento da vitrine pública (`/loja/[slug]`) nem do checkout. `comanda_id` é sempre `null` para pedidos de vitrine e de balcão.
- **TDD + tsc limpo:** `npx tsc --noEmit` e `npx vitest run` limpos antes de cada commit. Testes de unidade rodam offline (sem rede pro Supabase — o sandbox bloqueia; testar só funções puras/mapeamento).

---

### Task 1: Migration `0034_comandas.sql`

**Files:**
- Create: `supabase/migrations/0034_comandas.sql`

**Interfaces:**
- Consumes: tabelas `restaurantes`, `mesas`, `pedidos` (já existem); função `auth_restaurante_id()` (já existe).
- Produces: tabela `comandas` (colunas `id, restaurante_id, mesa_id, status, aberta_em, fechada_em`); coluna `pedidos.comanda_id uuid` nullable; índice único parcial `comandas_mesa_aberta_unq`.

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/0034_comandas.sql`:

```sql
-- PDV Fase 2 — comandas de mesa. Aditivo e idempotente.

create table if not exists comandas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  mesa_id uuid not null references mesas(id) on delete cascade,
  status text not null default 'aberta',   -- 'aberta' | 'fechada'
  aberta_em timestamptz not null default now(),
  fechada_em timestamptz
);

create index if not exists idx_comandas_restaurante on comandas(restaurante_id);
create index if not exists idx_comandas_mesa on comandas(mesa_id);

-- No máximo 1 comanda aberta por mesa (resolve corrida do find-or-create).
create unique index if not exists comandas_mesa_aberta_unq
  on comandas (restaurante_id, mesa_id) where status = 'aberta';

-- Liga cada pedido à sua comanda (null = pedido avulso: balcão ou vitrine).
alter table pedidos add column if not exists comanda_id uuid references comandas(id);
create index if not exists idx_pedidos_comanda on pedidos(comanda_id);

alter table comandas enable row level security;

drop policy if exists comandas_tenant_rw on comandas;
create policy comandas_tenant_rw on comandas
  for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());

grant select, insert, update, delete on comandas to authenticated;
```

- [ ] **Step 2: Validar sintaxe (revisão visual)**

Conferir contra `supabase/migrations/0033_pdv_mesas.sql`: mesma estrutura de policy/grant, `if not exists` em tudo. Não há runner para rodar localmente (db:setup quebrado, sem rede pro remoto no sandbox). A aplicação remota acontece na Task 7.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0034_comandas.sql
git commit -m "feat(pdv): migration 0034 — tabela comandas + pedidos.comanda_id"
```

---

### Task 2: Camada de queries `lib/queries/comandas.ts`

**Files:**
- Create: `lib/queries/comandas.ts`
- Test: `lib/queries/comandas.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` (service_role), `PEDIDO_SELECT`/`mapPedido`/`Pedido` de `lib/queries/pedidos.ts`, `Mesa`/`listarMesasAtivas` de `lib/queries/mesas.ts`.
- Produces:
  - `interface Comanda { id: string; mesaId: string; status: 'aberta' | 'fechada'; abertaEm: string; fechadaEm: string | null }`
  - `interface MesaComEstado extends Mesa { comandaAberta: Comanda | null; total: number; qtdPedidos: number }`
  - `function mapComandaRow(row): Comanda`
  - `async abrirOuObterComanda(admin, restauranteId, mesaId): Promise<Comanda>`
  - `async buscarComandaAberta(admin, restauranteId, mesaId): Promise<Comanda | null>`
  - `async listarPedidosDaComanda(admin, restauranteId, comandaId): Promise<Pedido[]>`
  - `async cancelarPedidoComanda(admin, restauranteId, pedidoId): Promise<void>`
  - `async fecharComanda(admin, restauranteId, comandaId): Promise<void>`
  - `async listarMesasComEstado(admin, restauranteId): Promise<MesaComEstado[]>`
  - `function calcularTotalComanda(pedidos: Pedido[]): number` (helper puro — soma `total` dos não-cancelados)

- [ ] **Step 1: Escrever os testes que falham**

Create `lib/queries/comandas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mapComandaRow, calcularTotalComanda } from './comandas'
import type { Pedido } from './pedidos'

describe('mapComandaRow', () => {
  it('mapeia uma linha do banco para Comanda', () => {
    const row = {
      id: 'c1',
      restaurante_id: 'r1',
      mesa_id: 'm1',
      status: 'aberta',
      aberta_em: '2026-06-27T10:00:00Z',
      fechada_em: null,
    }
    expect(mapComandaRow(row)).toEqual({
      id: 'c1',
      mesaId: 'm1',
      status: 'aberta',
      abertaEm: '2026-06-27T10:00:00Z',
      fechadaEm: null,
    })
  })
})

describe('calcularTotalComanda', () => {
  const base = { itens: [] } as unknown as Pedido
  it('soma o total dos pedidos não-cancelados', () => {
    const pedidos = [
      { ...base, status: 'recebido', total: 30 },
      { ...base, status: 'preparando', total: 20 },
    ] as Pedido[]
    expect(calcularTotalComanda(pedidos)).toBe(50)
  })

  it('ignora pedidos cancelados', () => {
    const pedidos = [
      { ...base, status: 'recebido', total: 30 },
      { ...base, status: 'cancelado', total: 99 },
    ] as Pedido[]
    expect(calcularTotalComanda(pedidos)).toBe(30)
  })

  it('retorna 0 para comanda sem pedidos', () => {
    expect(calcularTotalComanda([])).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e verificar que falha**

Run: `npx vitest run lib/queries/comandas.test.ts`
Expected: FAIL — `Cannot find module './comandas'`.

- [ ] **Step 3: Implementar `lib/queries/comandas.ts`**

> Nota: o `status` cancelado em `pedidos` é a string `'cancelado'` (mesmo valor já usado em `lib/queries/clientes.ts` e nas métricas, ver `StatusPedido`). `Pedido.total` é `number`.

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import { PEDIDO_SELECT, mapPedido, type Pedido } from './pedidos'
import { listarMesasAtivas, type Mesa } from './mesas'

export interface Comanda {
  id: string
  mesaId: string
  status: 'aberta' | 'fechada'
  abertaEm: string
  fechadaEm: string | null
}

export interface MesaComEstado extends Mesa {
  comandaAberta: Comanda | null
  total: number
  qtdPedidos: number
}

interface ComandaRow {
  id: string
  restaurante_id: string
  mesa_id: string
  status: string
  aberta_em: string
  fechada_em: string | null
}

const COMANDA_SELECT = 'id, restaurante_id, mesa_id, status, aberta_em, fechada_em'

export function mapComandaRow(row: ComandaRow): Comanda {
  return {
    id: row.id,
    mesaId: row.mesa_id,
    status: row.status === 'fechada' ? 'fechada' : 'aberta',
    abertaEm: row.aberta_em,
    fechadaEm: row.fechada_em ?? null,
  }
}

/** Soma o total dos pedidos não-cancelados. Helper puro. */
export function calcularTotalComanda(pedidos: Pedido[]): number {
  return pedidos
    .filter((p) => p.status !== 'cancelado')
    .reduce((s, p) => s + p.total, 0)
}

export async function buscarComandaAberta(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<Comanda | null> {
  const { data, error } = await admin
    .from('comandas')
    .select(COMANDA_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .eq('status', 'aberta')
    .maybeSingle()
  if (error) throw error
  return data ? mapComandaRow(data as ComandaRow) : null
}

/**
 * Find-or-create da comanda aberta da mesa. O índice único parcial
 * `comandas_mesa_aberta_unq` garante no máximo 1 aberta por mesa; em corrida,
 * o insert viola o unique (código 23505) e a gente re-busca a existente.
 */
export async function abrirOuObterComanda(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<Comanda> {
  const existente = await buscarComandaAberta(admin, restauranteId, mesaId)
  if (existente) return existente

  const { data, error } = await admin
    .from('comandas')
    .insert({ restaurante_id: restauranteId, mesa_id: mesaId })
    .select(COMANDA_SELECT)
    .single()

  if (error) {
    // Corrida: outra requisição criou a comanda entre o select e o insert.
    if (error.code === '23505') {
      const recuperada = await buscarComandaAberta(admin, restauranteId, mesaId)
      if (recuperada) return recuperada
    }
    throw error
  }
  return mapComandaRow(data as ComandaRow)
}

export async function listarPedidosDaComanda(
  admin: SupabaseClient,
  restauranteId: string,
  comandaId: string,
): Promise<Pedido[]> {
  const { data, error } = await admin
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('comanda_id', comandaId)
    .order('criado_em', { ascending: true })
  if (error) throw error
  return (data ?? []).map(mapPedido)
}

/** Cancela um pedido da comanda (status 'cancelado'): some do Kanban/cozinha e sai do total. */
export async function cancelarPedidoComanda(
  admin: SupabaseClient,
  restauranteId: string,
  pedidoId: string,
): Promise<void> {
  const { error } = await admin
    .from('pedidos')
    .update({ status: 'cancelado' })
    .eq('id', pedidoId)
    .eq('restaurante_id', restauranteId)
  if (error) throw error
}

/** Fecha a conta: marca a comanda como fechada. Só fecha se estiver aberta. */
export async function fecharComanda(
  admin: SupabaseClient,
  restauranteId: string,
  comandaId: string,
): Promise<void> {
  const { error } = await admin
    .from('comandas')
    .update({ status: 'fechada', fechada_em: new Date().toISOString() })
    .eq('id', comandaId)
    .eq('restaurante_id', restauranteId)
    .eq('status', 'aberta')
  if (error) throw error
}

/** Mesas ativas + estado de comanda aberta (total acumulado, qtd de pedidos não-cancelados). */
export async function listarMesasComEstado(
  admin: SupabaseClient,
  restauranteId: string,
): Promise<MesaComEstado[]> {
  const mesas = await listarMesasAtivas(admin, restauranteId)

  const { data: comandasData, error: comandasError } = await admin
    .from('comandas')
    .select(COMANDA_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('status', 'aberta')
  if (comandasError) throw comandasError
  const comandas = (comandasData ?? []).map((c) => mapComandaRow(c as ComandaRow))

  const estados: MesaComEstado[] = []
  for (const mesa of mesas) {
    const comandaAberta = comandas.find((c) => c.mesaId === mesa.id) ?? null
    let total = 0
    let qtdPedidos = 0
    if (comandaAberta) {
      const pedidos = await listarPedidosDaComanda(admin, restauranteId, comandaAberta.id)
      const ativos = pedidos.filter((p) => p.status !== 'cancelado')
      total = calcularTotalComanda(pedidos)
      qtdPedidos = ativos.length
    }
    estados.push({ ...mesa, comandaAberta, total, qtdPedidos })
  }
  return estados
}
```

> Se `PEDIDO_SELECT` e `mapPedido` ainda não estiverem exportados de `pedidos.ts`, exportá-los nesta task (são `const`/`function` internos hoje): trocar `const PEDIDO_SELECT` → `export const PEDIDO_SELECT` e `function mapPedido` → `export function mapPedido` em `lib/queries/pedidos.ts` (linhas ~115 e ~123).

- [ ] **Step 4: Rodar os testes e verificar que passam**

Run: `npx vitest run lib/queries/comandas.test.ts`
Expected: PASS (3 testes em `calcularTotalComanda` + 1 em `mapComandaRow`).

- [ ] **Step 5: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/comandas.ts lib/queries/comandas.test.ts lib/queries/pedidos.ts
git commit -m "feat(pdv): camada de queries de comandas (find-or-create, cancelar, fechar, estado de mesa)"
```

---

### Task 3: Ligar `comanda_id` na criação do pedido

**Files:**
- Modify: `lib/queries/pedidos.ts` (interface `NovoPedidoInput` ~805, insert do `criarPedido` ~945, `Pedido` ~27, `PedidoRow` ~72, `PEDIDO_SELECT` ~115, `mapPedido` ~123)

**Interfaces:**
- Consumes: `NovoPedidoInput` da Task 4 (route passa `comandaId`).
- Produces: `NovoPedidoInput.comandaId?: string`; `Pedido.comandaId: string | null` exposto em todo lugar que lê pedido (Kanban/cozinha/comanda).

- [ ] **Step 1: Adicionar `comandaId` ao `NovoPedidoInput`**

Em `lib/queries/pedidos.ts`, dentro de `interface NovoPedidoInput` (após `mesa?: string`):

```typescript
  /** Nome da mesa — só usado quando origem === 'pdv'. */
  mesa?: string
  /** Comanda da mesa (PDV Fase 2). Null/ausente = pedido avulso (balcão/vitrine). */
  comandaId?: string
```

- [ ] **Step 2: Persistir `comanda_id` no insert do `criarPedido`**

No objeto `.insert({...})` do `criarPedido` (após `mesa: input.origem === 'pdv' ? ... : null,`):

```typescript
      origem: input.origem ?? 'cardapio',
      mesa: input.origem === 'pdv' ? (input.mesa ?? null) : null,
      comanda_id: input.comandaId ?? null,
```

- [ ] **Step 3: Expor `comandaId` no tipo `Pedido` + `PedidoRow` + `PEDIDO_SELECT` + `mapPedido`**

Em `interface Pedido` (após `mesa: string | null`):
```typescript
  mesa: string | null
  comandaId: string | null
```

Em `interface PedidoRow` (após `mesa: string | null`):
```typescript
  mesa: string | null
  comanda_id: string | null
```

Em `PEDIDO_SELECT`, adicionar `comanda_id` à lista de colunas (junto de `origem, mesa`):
```
  entregador_id, preparando_por, preparado_por, preparando_notificado, telefone_verificado, origem, mesa, comanda_id, criado_em, atualizado_em,
```

Em `mapPedido`, após `mesa: row.mesa ?? null,`:
```typescript
    mesa: row.mesa ?? null,
    comandaId: row.comanda_id ?? null,
```

- [ ] **Step 4: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros. (Confirma que nenhum outro consumidor de `Pedido` quebrou — `comandaId` é campo novo, aditivo.)

- [ ] **Step 5: Rodar a suíte de testes**

Run: `npx vitest run`
Expected: PASS (inclui `comandas.test.ts` e `mesas.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add lib/queries/pedidos.ts
git commit -m "feat(pdv): propagar comanda_id em criarPedido e no tipo Pedido"
```

---

### Task 4: Route do PDV resolve mesa → comanda

**Files:**
- Modify: `app/api/admin/pdv/pedido/route.ts`

**Interfaces:**
- Consumes: `abrirOuObterComanda` (Task 2), `NovoPedidoInput.comandaId` (Task 3). Body do cliente passa a incluir `mesaId?: string` (a tela manda — Task 5).
- Produces: pedido criado com `comanda_id` correto quando há mesa; balcão fica avulso.

- [ ] **Step 1: Resolver a comanda antes de criar o pedido**

Reescrever o corpo do `POST` em `app/api/admin/pdv/pedido/route.ts` para, quando vier `mesaId` no body, abrir/obter a comanda e injetar `comandaId`. O `mesaId` é um campo só-de-transporte: removê-lo antes de montar o `NovoPedidoInput`.

```typescript
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'
import { abrirOuObterComanda } from '@/lib/queries/comandas'

interface PdvPedidoBody extends NovoPedidoInput {
  /** Id da mesa (transporte) — usado p/ resolver a comanda; não vai pro pedido. */
  mesaId?: string
}

export async function POST(request: Request) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: PdvPedidoBody
  try {
    body = (await request.json()) as PdvPedidoBody
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const { mesaId, ...rest } = body
  const admin = getAdminSupabase()

  try {
    // Mesa selecionada → agrupa numa comanda (find-or-create). Balcão fica avulso.
    let comandaId: string | undefined
    if (mesaId) {
      const comanda = await abrirOuObterComanda(admin, restauranteId, mesaId)
      comandaId = comanda.id
    }

    // Força a origem PDV no servidor (o cliente não decide isso).
    const input: NovoPedidoInput = { ...rest, origem: 'pdv', tipo: 'retirada', comandaId }

    const pedido = await criarPedido(admin, restauranteId, input)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
```

- [ ] **Step 2: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/pdv/pedido/route.ts
git commit -m "feat(pdv): route resolve mesaId -> comanda (find-or-create) ao lançar pedido"
```

---

### Task 5: Rotas de comanda (listar/cancelar/fechar)

**Files:**
- Create: `app/api/admin/pdv/comanda/route.ts` (GET estado das mesas + GET pedidos de uma comanda)
- Create: `app/api/admin/pdv/comanda/[id]/fechar/route.ts` (POST fechar conta)
- Create: `app/api/admin/pdv/pedido/[id]/cancelar/route.ts` (POST cancelar pedido)

**Interfaces:**
- Consumes: `listarMesasComEstado`, `listarPedidosDaComanda`, `fecharComanda`, `cancelarPedidoComanda` (Task 2); auth via `getServerSupabase` + `buscarRestauranteIdDoUsuario` (mesmo padrão da route de pedido).
- Produces: endpoints consumidos pela tela (Task 6).
  - `GET /api/admin/pdv/comanda` → `{ mesas: MesaComEstado[] }`
  - `GET /api/admin/pdv/comanda?comandaId=...` → `{ pedidos: Pedido[] }`
  - `POST /api/admin/pdv/comanda/[id]/fechar` → `{ ok: true }`
  - `POST /api/admin/pdv/pedido/[id]/cancelar` → `{ ok: true }`

- [ ] **Step 1: Criar `app/api/admin/pdv/comanda/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { listarMesasComEstado, listarPedidosDaComanda } from '@/lib/queries/comandas'

export async function GET(request: Request) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdminSupabase()
  const comandaId = new URL(request.url).searchParams.get('comandaId')

  try {
    if (comandaId) {
      const pedidos = await listarPedidosDaComanda(admin, restauranteId, comandaId)
      return NextResponse.json({ pedidos })
    }
    const mesas = await listarMesasComEstado(admin, restauranteId)
    return NextResponse.json({ mesas })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao carregar comandas'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
```

- [ ] **Step 2: Criar `app/api/admin/pdv/comanda/[id]/fechar/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { fecharComanda } from '@/lib/queries/comandas'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdminSupabase()
  try {
    await fecharComanda(admin, restauranteId, params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao fechar conta'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
```

- [ ] **Step 3: Criar `app/api/admin/pdv/pedido/[id]/cancelar/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { cancelarPedidoComanda } from '@/lib/queries/comandas'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdminSupabase()
  try {
    await cancelarPedidoComanda(admin, restauranteId, params.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao cancelar pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
```

> Conferir a assinatura de `params` contra outras rotas dinâmicas do projeto (ex. `app/api/entregador/[token]/...`). Se o projeto usa `params: Promise<{...}>` (Next 15) em vez de `{...}` (Next 14), seguir o padrão existente. Verificar com: `grep -rn "params" app/api/entregador` antes de escrever.

- [ ] **Step 4: tsc limpo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/pdv/comanda app/api/admin/pdv/pedido/[id]
git commit -m "feat(pdv): rotas de comanda — estado das mesas, fechar conta, cancelar pedido"
```

---

### Task 6: UI `/admin/pdv` mesa-aware + painel de comanda

**Files:**
- Modify: `app/admin/pdv/page.tsx`

**Interfaces:**
- Consumes: rotas da Task 5 (`GET /api/admin/pdv/comanda`, `POST .../fechar`, `POST .../cancelar`); tipos `MesaComEstado`, `Comanda`, `Pedido`.
- Produces: nada (folha — é a tela final).

Esta é a maior task. Decomposta em passos. A tela hoje tem 3 colunas (Mesas / Cardápio / Comanda-em-montagem). A Fase 2 adiciona: **estado de ocupação na coluna de mesas** e um **painel de comanda da mesa** (pedidos já lançados) quando a mesa selecionada está ocupada.

- [ ] **Step 1: Trocar a fonte das mesas para `listarMesasComEstado` via API**

No `useEffect` de load, substituir o `listarMesasAtivas` direto pelo fetch de `GET /api/admin/pdv/comanda` (a tela roda com a sessão do navegador, mas `listarMesasComEstado` precisa de service_role para ler pedidos de outras origens — por isso vai pela route). Trocar o state `mesas: Mesa[]` por `mesasEstado: MesaComEstado[]`.

```typescript
// import no topo:
import type { MesaComEstado } from '@/lib/queries/comandas'
import type { Pedido } from '@/lib/queries/pedidos'

// state:
const [mesasEstado, setMesasEstado] = useState<MesaComEstado[]>([])

// função de refetch reutilizável:
const recarregarMesas = useCallback(async () => {
  const res = await fetch('/api/admin/pdv/comanda')
  if (!res.ok) return
  const data = (await res.json()) as { mesas: MesaComEstado[] }
  setMesasEstado(data.mesas)
}, [])
```

No load inicial, remover `listarMesasAtivas` do `Promise.all` e chamar `recarregarMesas()` (o resto do `Promise.all` — itens, grupos, pizza — fica). `mesaSelecionada` passa a ser `MesaComEstado | null`.

- [ ] **Step 2: Mostrar estado de ocupação na grade de mesas**

Na coluna 1, cada botão de mesa passa a indicar **ocupada** (tem `comandaAberta`) com acento visual + total. Usar a paleta: mesa ocupada = borda/acento `--status-pending` (laranja) ou `--primary`; mostrar `formatBRL(mesa.total)` abaixo do nome quando `qtdPedidos > 0`.

```tsx
{mesasEstado.map((mesa) => {
  const ocupada = mesa.comandaAberta !== null
  const ativa = mesaEscolhida && mesaSelecionada?.id === mesa.id
  return (
    <button
      key={mesa.id}
      type="button"
      onClick={() => selecionarMesa(mesa)}
      className={[
        'rounded-menuzia border px-2 py-2 text-center transition-colors',
        ativa
          ? 'border-primary bg-primary text-white'
          : ocupada
            ? 'border-status-pending bg-status-pending/10 text-text-main hover:border-status-pending'
            : 'border-border bg-page text-text-main hover:border-primary hover:text-primary',
      ].join(' ')}
    >
      <span className="block text-[12px] font-semibold">{mesa.nome}</span>
      {ocupada && (
        <span className={['block text-[10px] font-bold', ativa ? 'text-white/90' : 'text-status-pending'].join(' ')}>
          {formatBRL(mesa.total)}
        </span>
      )}
    </button>
  )
})}
```

- [ ] **Step 3: Carregar os pedidos da comanda ao selecionar mesa ocupada**

Novo state + efeito: quando `mesaSelecionada?.comandaAberta` existir, buscar os pedidos lançados.

```typescript
const [pedidosComanda, setPedidosComanda] = useState<Pedido[]>([])
const [carregandoComanda, setCarregandoComanda] = useState(false)

const recarregarComanda = useCallback(async (comandaId: string) => {
  setCarregandoComanda(true)
  try {
    const res = await fetch(`/api/admin/pdv/comanda?comandaId=${comandaId}`)
    if (!res.ok) return
    const data = (await res.json()) as { pedidos: Pedido[] }
    setPedidosComanda(data.pedidos)
  } finally {
    setCarregandoComanda(false)
  }
}, [])

useEffect(() => {
  const comandaId = mesaSelecionada?.comandaAberta?.id
  if (comandaId) {
    void recarregarComanda(comandaId)
  } else {
    setPedidosComanda([])
  }
}, [mesaSelecionada, recarregarComanda])
```

- [ ] **Step 4: Renderizar o painel da comanda (pedidos lançados) na coluna 3**

A coluna 3 hoje mostra só a **comanda-em-montagem** (itens ainda não lançados). Adicionar, acima dela, uma seção **"Conta da mesa"** quando `mesaSelecionada?.comandaAberta` existir: lista de pedidos já lançados, cada um com número, status (badge), itens resumidos e valor; pedidos `cancelado` aparecem riscados. Abaixo: total da conta (`calcularTotalComanda` ou somar no servidor — usar o `mesa.total` já vindo, ou recomputar de `pedidosComanda`), e os botões **Cancelar pedido** (por pedido) e **Fechar conta**.

Usar `<Badge>` de `components/ui/badge.tsx` para status (mesmo mapa `STATUS_PEDIDO_INFO` do Kanban se exportado; senão badge simples). Pedido cancelado: `line-through opacity-50`.

```tsx
{mesaSelecionada?.comandaAberta && (
  <div className="border-b border-border">
    <div className="flex items-center justify-between px-3 py-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Conta da mesa</p>
      <span className="text-[12px] font-bold text-text-main">{formatBRL(totalConta)}</span>
    </div>
    <ul className="divide-y divide-border">
      {pedidosComanda.map((p) => {
        const cancelado = p.status === 'cancelado'
        return (
          <li key={p.id} className={['px-3 py-2', cancelado ? 'opacity-50 line-through' : ''].join(' ')}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-text-main">Pedido #{p.numero}</span>
              <span className="text-[12px] font-semibold text-text-main">{formatBRL(p.total)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-text-subtle">
              {p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}
            </p>
            {!cancelado && (
              <button
                type="button"
                onClick={() => cancelarPedido(p.id)}
                className="mt-1 text-[11px] font-semibold text-danger hover:underline"
              >
                Cancelar pedido
              </button>
            )}
          </li>
        )
      })}
    </ul>
    <div className="p-3">
      <Button
        variant="outline"
        className="w-full"
        disabled={totalConta <= 0 || fechando}
        onClick={fecharConta}
      >
        {fechando ? 'Fechando…' : 'Fechar conta'}
      </Button>
    </div>
  </div>
)}
```

`totalConta` = `pedidosComanda.filter(p => p.status !== 'cancelado').reduce((s,p)=>s+p.total,0)`.

- [ ] **Step 5: Implementar `cancelarPedido` e `fecharConta`**

```typescript
const [fechando, setFechando] = useState(false)

async function cancelarPedido(pedidoId: string) {
  if (!confirm('Cancelar este pedido? Ele some da cozinha e sai da conta.')) return
  const res = await fetch(`/api/admin/pdv/pedido/${pedidoId}/cancelar`, { method: 'POST' })
  if (res.ok) {
    const comandaId = mesaSelecionada?.comandaAberta?.id
    if (comandaId) await recarregarComanda(comandaId)
    await recarregarMesas()
  }
}

async function fecharConta() {
  const comandaId = mesaSelecionada?.comandaAberta?.id
  if (!comandaId || fechando) return
  const emPreparo = pedidosComanda.some((p) => p.status === 'preparando' || p.status === 'recebido')
  const aviso = emPreparo
    ? 'Há pedido ainda em preparo. Fechar a conta mesmo assim?'
    : `Fechar a conta de ${mesaSelecionada?.nome}?`
  if (!confirm(aviso)) return
  setFechando(true)
  try {
    const res = await fetch(`/api/admin/pdv/comanda/${comandaId}/fechar`, { method: 'POST' })
    if (res.ok) {
      setPedidosComanda([])
      setMesaSelecionada(null)
      setMesaEscolhida(false)
      await recarregarMesas()
    }
  } finally {
    setFechando(false)
  }
}
```

- [ ] **Step 6: Após lançar pedido, recarregar mesa + comanda**

No `lancarNaCozinha`, no ramo de sucesso (`res.status === 201`), além de limpar a comanda-em-montagem, passar `mesaId` no body e dar refresh do estado:

No `body`, adicionar:
```typescript
      mesa: mesaSelecionada?.nome,
      mesaId: mesaSelecionada?.id,
```

No sucesso (após `setLaunchMsg({ type: 'ok', ... })`):
```typescript
      await recarregarMesas()
      if (mesaSelecionada) {
        // re-seleciona a mesa atualizada (agora ocupada) e carrega a conta
        const atualizadas = await fetch('/api/admin/pdv/comanda').then((r) => r.json()).catch(() => null)
        const nova = (atualizadas?.mesas as MesaComEstado[] | undefined)?.find((m) => m.id === mesaSelecionada.id)
        if (nova) {
          setMesaSelecionada(nova)
          if (nova.comandaAberta) await recarregarComanda(nova.comandaAberta.id)
        }
      }
```
> Simplificação aceitável: como `recarregarMesas` já atualiza `mesasEstado`, dá pra derivar a mesa nova de lá em vez de um segundo fetch. Implementar do jeito mais limpo; o importante é que após lançar, a mesa apareça ocupada e a conta apareça.

- [ ] **Step 7: Realtime — atualizar estado ao mudar pedidos**

Adicionar uma subscription Supabase no canal de `pedidos` (mesmo padrão do Kanban em `app/admin/pedidos/page.tsx` — procurar `.channel(` lá e copiar a forma). No callback, chamar `recarregarMesas()` e, se houver comanda aberta selecionada, `recarregarComanda(comandaId)`. Cleanup no unmount.

```typescript
useEffect(() => {
  const channel = supabase
    .channel('pdv-comandas')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, () => {
      void recarregarMesas()
      const comandaId = mesaSelecionada?.comandaAberta?.id
      if (comandaId) void recarregarComanda(comandaId)
    })
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}, [supabase, recarregarMesas, recarregarComanda, mesaSelecionada])
```
> Conferir a assinatura exata de `.channel/.on` contra o Kanban — versão do supabase-js pode mudar o shape do filtro. Copiar o padrão que já funciona lá.

- [ ] **Step 8: tsc + build limpos**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx next build` (ou `npm run build`)
Expected: build conclui sem erro de tipo/lint que quebre.

- [ ] **Step 9: Commit**

```bash
git add app/admin/pdv/page.tsx
git commit -m "feat(pdv): mesa-aware — estado de ocupação, painel da conta, cancelar pedido, fechar conta"
```

---

### Task 7: Aplicar migration no remoto + docs + memória

**Files:**
- Modify: `docs/superpowers/PDV-STATUS-HANDOFF.md`
- Modify: memória (`MEMORY.md` + arquivos de status do PDV)

**Interfaces:**
- Consumes: migration `0034_comandas.sql` (Task 1).
- Produces: banco remoto atualizado; docs/memória refletindo Fase 2 entregue.

- [ ] **Step 1: Pedir ao usuário para aplicar a migration no remoto**

Avisar o usuário: colar o conteúdo de `supabase/migrations/0034_comandas.sql` no **SQL editor do Supabase** e rodar (mesmo fluxo da 0033, pois `db:setup` está quebrado). Aguardar confirmação de que rodou sem erro antes de marcar a feature como usável.

- [ ] **Step 2: Atualizar `PDV-STATUS-HANDOFF.md`**

Marcar Fase 2 como ✅ FEITA, listar arquivos/commits, mover a pendência de migration, e apontar a Fase 3 como o próximo passo. Atualizar a seção "Como retomar".

- [ ] **Step 3: Atualizar memória**

Atualizar `project_pdv_handoff.md` e `project_pdv_origem_tag.md` (e a linha no `MEMORY.md`) para refletir Fase 2 entregue + Fase 3 pendente.

- [ ] **Step 4: Commit + push**

```bash
git add docs/superpowers/PDV-STATUS-HANDOFF.md
git commit -m "docs(pdv): Fase 2 (comanda de mesa) entregue — atualiza handoff"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- §2 Modelo de dados → Task 1 ✅
- §3 Camada de queries (todas as funções) → Task 2 ✅
- §4 Ligação na criação do pedido (NovoPedidoInput.comandaId, route resolve mesaId) → Tasks 3 + 4 ✅
- §5 UI grade com estado + painel da comanda + cancelar + fechar + realtime → Task 6 ✅
- §6 Bordas (corrida find-or-create, fechar vazia bloqueado, fechar com preparo avisa, cancelado fora do total) → Task 2 (índice/guards) + Task 6 (UI guards/avisos) ✅
- §7 Fora de escopo (Fase 3) → não implementado, correto ✅
- §8 Sequência → Tasks 1-7 seguem a ordem ✅

**Placeholder scan:** Sem TBD/TODO. Código completo em cada step. Os dois pontos "conferir padrão existente" (assinatura de `params` em rotas dinâmicas Next 14/15; shape do `.channel/.on` realtime) são verificações de conformidade com o codebase, não placeholders — o engenheiro confirma o padrão local e segue. Aceitável.

**Type consistency:** `Comanda` (id, mesaId, status, abertaEm, fechadaEm), `MesaComEstado extends Mesa` (+ comandaAberta, total, qtdPedidos), `NovoPedidoInput.comandaId?`, `Pedido.comandaId` — nomes batem entre Tasks 2, 3, 4, 6. `calcularTotalComanda` mesmo nome em todo lugar. `PEDIDO_SELECT`/`mapPedido` exportados na Task 2 e consumidos lá mesmo. Rotas e tipos de retorno (`{ mesas }`, `{ pedidos }`, `{ ok: true }`) consistentes entre Task 5 (produz) e Task 6 (consome).
