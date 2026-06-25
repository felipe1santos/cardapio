# Acesso restrito por Estação + Kanban da Cozinha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a cozinha acesse um Kanban restrito por link/QR (sem login), com as ações travadas no servidor conforme o modo da estação (produção / expedição / cozinha completa).

**Architecture:** Espelha o portal do entregador já existente. Uma tabela `estacoes` (token público por estação). Páginas e rotas server validam o token via admin client (ignora RLS) e filtram/gateiam por `modo`. A lógica de modo (status visíveis + ações permitidas) vive num módulo puro testável. A gestão das estações fica no painel Ajustes, reusando o gerador de QR já usado na Logística.

**Tech Stack:** Next.js (App Router) · Supabase (Postgres + admin/service-role client) · Tailwind · vitest · qrcode (`^1.5.4`, já instalado).

## Global Constraints

- Identidade Menuzia: fonte Inter, `--radius-max: 3px` (classe `rounded-menuzia`), paleta de status `--status-pending` (laranja), `--status-preparing` (azul), `--status-ready` (verde). Botões caixa-alta 11px.
- Token de estação validado **server-side com admin client** (`getAdminSupabase()`), nunca por RLS. Anon não lê `estacoes`.
- **Segurança crítica:** o admin client ignora RLS. Toda rota de ação deve confirmar que o `pedido.restaurante_id === estacao.restaurante_id` antes de mutar — senão um token de uma loja poderia mexer no pedido de outra.
- Reusar as mutations de pedido existentes (`lib/queries/pedidos.ts`): `avancarStatusPedido(supabase, pedidoId, status)`, `marcarPedidoEntregue(supabase, pedidoId)`. Não duplicar.
- Polling da cozinha: 6s. "Online" no painel: `ultimo_visto_em` < 30s.
- Test runner: `npm test` (= `vitest run`). Rodar arquivo único: `npx vitest run <caminho>`.
- Não alterar o painel `/admin/pedidos`, o portal do entregador, nem o login.

## File Structure

- `supabase/migrations/0029_estacoes_cozinha.sql` — tabela `estacoes` + RLS (CRIAR; tabela já existe no banco remoto, ver Task 2).
- `lib/cozinha/modo.ts` — lógica pura: tipos `ModoEstacao`/`AcaoCozinha`, status visíveis por modo, ações permitidas por modo, mapa ação→transição. (CRIAR)
- `lib/cozinha/modo.test.ts` — testes da lógica pura. (CRIAR)
- `lib/queries/estacoes.ts` — CRUD de estação (sessão do tenant) + lookup por token e heartbeat (admin). (CRIAR)
- `app/api/cozinha/[token]/route.ts` — GET: dados da estação + pedidos filtrados por modo + heartbeat. (CRIAR)
- `app/api/cozinha/[token]/pedidos/[id]/acao/route.ts` — POST: executa ação validada pelo modo + tenant. (CRIAR)
- `app/cozinha/[token]/page.tsx` — Kanban restrito (client, polling, som). (CRIAR)
- `app/admin/ajustes/page.tsx` — nova seção "Estações de cozinha". (MODIFICAR)

---

### Task 1: Lógica pura de modo (status visíveis + ações permitidas)

Núcleo testável do gate. Sem dependências de Supabase.

**Files:**
- Create: `lib/cozinha/modo.ts`
- Test: `lib/cozinha/modo.test.ts`

**Interfaces:**
- Consumes: `StatusPedido` de `lib/queries/pedidos.ts` (`'recebido' | 'preparando' | 'pronto' | 'em_rota' | 'entregue' | 'cancelado'`).
- Produces:
  - `type ModoEstacao = 'producao' | 'expedicao' | 'completa'`
  - `type AcaoCozinha = 'aceitar' | 'pronto' | 'entregue'`
  - `statusVisiveis(modo: ModoEstacao): StatusPedido[]`
  - `podeExecutar(modo: ModoEstacao, acao: AcaoCozinha): boolean`
  - `transicaoDe(acao: AcaoCozinha): { status: StatusPedido; viaEntregue: boolean }` — `entregue` usa `marcarPedidoEntregue` (viaEntregue=true); as outras usam `avancarStatusPedido`.
  - `MODOS: ModoEstacao[]` e `LABEL_MODO: Record<ModoEstacao, string>` (`producao: 'Produção'`, `expedicao: 'Expedição'`, `completa: 'Cozinha completa'`).

- [ ] **Step 1: Write the failing test**

```typescript
// lib/cozinha/modo.test.ts
import { describe, it, expect } from 'vitest'
import { statusVisiveis, podeExecutar, transicaoDe, MODOS, LABEL_MODO } from './modo'

describe('statusVisiveis', () => {
  it('produção vê recebido e preparando', () => {
    expect(statusVisiveis('producao')).toEqual(['recebido', 'preparando'])
  })
  it('expedição vê só pronto', () => {
    expect(statusVisiveis('expedicao')).toEqual(['pronto'])
  })
  it('completa vê recebido, preparando e pronto', () => {
    expect(statusVisiveis('completa')).toEqual(['recebido', 'preparando', 'pronto'])
  })
})

describe('podeExecutar', () => {
  it('produção aceita e marca pronto, mas não entrega', () => {
    expect(podeExecutar('producao', 'aceitar')).toBe(true)
    expect(podeExecutar('producao', 'pronto')).toBe(true)
    expect(podeExecutar('producao', 'entregue')).toBe(false)
  })
  it('expedição só entrega', () => {
    expect(podeExecutar('expedicao', 'entregue')).toBe(true)
    expect(podeExecutar('expedicao', 'aceitar')).toBe(false)
    expect(podeExecutar('expedicao', 'pronto')).toBe(false)
  })
  it('completa faz tudo', () => {
    for (const a of ['aceitar', 'pronto', 'entregue'] as const) {
      expect(podeExecutar('completa', a)).toBe(true)
    }
  })
})

describe('transicaoDe', () => {
  it('aceitar → preparando via avançar', () => {
    expect(transicaoDe('aceitar')).toEqual({ status: 'preparando', viaEntregue: false })
  })
  it('pronto → pronto via avançar', () => {
    expect(transicaoDe('pronto')).toEqual({ status: 'pronto', viaEntregue: false })
  })
  it('entregue → entregue via marcarPedidoEntregue', () => {
    expect(transicaoDe('entregue')).toEqual({ status: 'entregue', viaEntregue: true })
  })
})

describe('metadados', () => {
  it('lista os 3 modos com rótulos', () => {
    expect(MODOS).toEqual(['producao', 'expedicao', 'completa'])
    expect(LABEL_MODO.producao).toBe('Produção')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/cozinha/modo.test.ts`
Expected: FAIL — `Cannot find module './modo'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/cozinha/modo.ts
// Lógica pura do acesso da cozinha por estação: o que cada modo VÊ e o que pode FAZER.
// Sem dependência de Supabase — é o gate testável reusado pela rota de ação (servidor).
import type { StatusPedido } from '@/lib/queries/pedidos'

export type ModoEstacao = 'producao' | 'expedicao' | 'completa'
export type AcaoCozinha = 'aceitar' | 'pronto' | 'entregue'

export const MODOS: ModoEstacao[] = ['producao', 'expedicao', 'completa']

export const LABEL_MODO: Record<ModoEstacao, string> = {
  producao: 'Produção',
  expedicao: 'Expedição',
  completa: 'Cozinha completa',
}

const STATUS_POR_MODO: Record<ModoEstacao, StatusPedido[]> = {
  producao: ['recebido', 'preparando'],
  expedicao: ['pronto'],
  completa: ['recebido', 'preparando', 'pronto'],
}

const ACOES_POR_MODO: Record<ModoEstacao, AcaoCozinha[]> = {
  producao: ['aceitar', 'pronto'],
  expedicao: ['entregue'],
  completa: ['aceitar', 'pronto', 'entregue'],
}

/** Status de pedido que a estação enxerga, conforme o modo. */
export function statusVisiveis(modo: ModoEstacao): StatusPedido[] {
  return STATUS_POR_MODO[modo]
}

/** Se o modo permite a ação. Gate de segurança — chamado no servidor antes de mutar. */
export function podeExecutar(modo: ModoEstacao, acao: AcaoCozinha): boolean {
  return ACOES_POR_MODO[modo].includes(acao)
}

/**
 * Transição de status de uma ação. `viaEntregue` indica usar marcarPedidoEntregue
 * (que registra a entrega) em vez de só avançar o status.
 */
export function transicaoDe(acao: AcaoCozinha): { status: StatusPedido; viaEntregue: boolean } {
  if (acao === 'aceitar') return { status: 'preparando', viaEntregue: false }
  if (acao === 'pronto') return { status: 'pronto', viaEntregue: false }
  return { status: 'entregue', viaEntregue: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/cozinha/modo.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Commit**

```bash
git add lib/cozinha/modo.ts lib/cozinha/modo.test.ts
git commit -m "feat(cozinha): lógica pura de modo da estação (status + ações)"
```

---

### Task 2: Migration + queries de estação

Tabela `estacoes` + camada de acesso a dados (CRUD do tenant + lookup/heartbeat por token).

**Nota:** a tabela já foi criada manualmente no banco remoto. A migration existe para o
histórico do repo e para `db:setup` em ambiente novo. **Aplicar no remoto agora: rodar só
o bloco de RLS** (Step 6) — o `create table` já existe lá.

**Files:**
- Create: `supabase/migrations/0029_estacoes_cozinha.sql`
- Create: `lib/queries/estacoes.ts`

**Interfaces:**
- Consumes: `getAdminSupabase()` de `lib/supabase/admin.ts`; `SupabaseClient` de `@supabase/supabase-js`; `ModoEstacao` de `lib/cozinha/modo.ts`.
- Produces:
  - `interface Estacao { id: string; nome: string; modo: ModoEstacao; token: string; ativo: boolean; online: boolean; criadoEm: string }`
  - `interface EstacaoPortal { id: string; nome: string; modo: ModoEstacao; restauranteId: string; restauranteNome: string }`
  - `listarEstacoes(supabase, restauranteId): Promise<Estacao[]>`
  - `criarEstacao(supabase, restauranteId, nome, modo): Promise<void>`
  - `atualizarEstacao(supabase, id, dados: { nome?: string; modo?: ModoEstacao; ativo?: boolean }): Promise<void>`
  - `rotacionarTokenEstacao(supabase, id): Promise<void>`
  - `removerEstacao(supabase, id): Promise<void>`
  - `buscarEstacaoPorToken(admin, token): Promise<EstacaoPortal | null>` — só estação `ativo = true`.
  - `registrarHeartbeatEstacao(admin, estacaoId): Promise<void>`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/0029_estacoes_cozinha.sql
-- ============================================================================
-- Estações de cozinha: acesso restrito por token (link/QR), sem login.
-- Cada estação tem um modo que define o que vê e quais ações pode executar.
-- Validação do token é server-side (admin client), igual ao portal do entregador.
-- ============================================================================

create table estacoes (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,
  modo text not null check (modo in ('producao','expedicao','completa')),
  token uuid not null unique default gen_random_uuid(),
  ativo boolean not null default true,
  ultimo_visto_em timestamptz,
  criado_em timestamptz not null default now()
);

create index estacoes_restaurante_id_idx on estacoes (restaurante_id);

alter table estacoes enable row level security;

-- O tenant gerencia (CRUD) só as estações da própria loja, pelo painel.
create policy "Tenant manages own stations"
  on estacoes for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());
```

- [ ] **Step 2: Write `lib/queries/estacoes.ts`**

```typescript
// lib/queries/estacoes.ts
// Camada de dados das estações de cozinha. CRUD usa a sessão do tenant (RLS);
// lookup por token e heartbeat usam o admin client (acesso público sem login).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModoEstacao } from '@/lib/cozinha/modo'

/** Estação online se enviou heartbeat nos últimos 30s. */
const ESTACAO_ONLINE_MS = 30 * 1000

export interface Estacao {
  id: string
  nome: string
  modo: ModoEstacao
  token: string
  ativo: boolean
  online: boolean
  criadoEm: string
}

export interface EstacaoPortal {
  id: string
  nome: string
  modo: ModoEstacao
  restauranteId: string
  restauranteNome: string
}

export async function listarEstacoes(supabase: SupabaseClient, restauranteId: string): Promise<Estacao[]> {
  const { data, error } = await supabase
    .from('estacoes')
    .select('id, nome, modo, token, ativo, ultimo_visto_em, criado_em')
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: true })
  if (error) throw error

  const agora = Date.now()
  return (data ?? []).map((e) => ({
    id: e.id,
    nome: e.nome,
    modo: e.modo as ModoEstacao,
    token: e.token,
    ativo: e.ativo,
    online: !!e.ultimo_visto_em && agora - new Date(e.ultimo_visto_em).getTime() < ESTACAO_ONLINE_MS,
    criadoEm: e.criado_em,
  }))
}

export async function criarEstacao(supabase: SupabaseClient, restauranteId: string, nome: string, modo: ModoEstacao): Promise<void> {
  const { error } = await supabase.from('estacoes').insert({ restaurante_id: restauranteId, nome: nome.trim(), modo })
  if (error) throw error
}

export async function atualizarEstacao(
  supabase: SupabaseClient,
  id: string,
  dados: { nome?: string; modo?: ModoEstacao; ativo?: boolean }
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (dados.nome !== undefined) patch.nome = dados.nome.trim()
  if (dados.modo !== undefined) patch.modo = dados.modo
  if (dados.ativo !== undefined) patch.ativo = dados.ativo
  const { error } = await supabase.from('estacoes').update(patch).eq('id', id)
  if (error) throw error
}

export async function rotacionarTokenEstacao(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('estacoes').update({ token: crypto.randomUUID() }).eq('id', id)
  if (error) throw error
}

export async function removerEstacao(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('estacoes').delete().eq('id', id)
  if (error) throw error
}

/** Localiza a estação ATIVA pelo token público. Null se não existe ou está desativada. */
export async function buscarEstacaoPorToken(admin: SupabaseClient, token: string): Promise<EstacaoPortal | null> {
  const { data, error } = await admin
    .from('estacoes')
    .select('id, nome, modo, ativo, restaurante_id, restaurantes ( nome )')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!data || !data.ativo) return null

  const restaurantes = data.restaurantes as unknown as { nome: string } | { nome: string }[] | null
  const restauranteNome = Array.isArray(restaurantes) ? restaurantes[0]?.nome : restaurantes?.nome

  return {
    id: data.id,
    nome: data.nome,
    modo: data.modo as ModoEstacao,
    restauranteId: data.restaurante_id,
    restauranteNome: restauranteNome ?? '',
  }
}

export async function registrarHeartbeatEstacao(admin: SupabaseClient, estacaoId: string): Promise<void> {
  await admin.from('estacoes').update({ ultimo_visto_em: new Date().toISOString() }).eq('id', estacaoId)
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "estacoes|cozinha/modo" || echo "OK: sem erros nos arquivos novos"`
Expected: `OK: sem erros nos arquivos novos`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0029_estacoes_cozinha.sql lib/queries/estacoes.ts
git commit -m "feat(cozinha): tabela estacoes + queries (CRUD, token, heartbeat)"
```

- [ ] **Step 5: Aplicar RLS no banco remoto**

A tabela já existe no remoto (criada manualmente). Rodar **apenas** este bloco no SQL editor do Supabase (idempotente o suficiente; se a policy já existir, dropar antes):

```sql
alter table estacoes enable row level security;

drop policy if exists "Tenant manages own stations" on estacoes;
create policy "Tenant manages own stations"
  on estacoes for all
  using (restaurante_id = auth_restaurante_id())
  with check (restaurante_id = auth_restaurante_id());
```

Confirmar: `select relrowsecurity from pg_class where relname = 'estacoes';` → `t`.

---

### Task 3: Rota GET do portal da cozinha

Valida o token, grava heartbeat, devolve nome/modo + pedidos filtrados pelo modo.

**Files:**
- Create: `app/api/cozinha/[token]/route.ts`

**Interfaces:**
- Consumes: `getAdminSupabase()`; `buscarEstacaoPorToken`, `registrarHeartbeatEstacao` (Task 2); `statusVisiveis` (Task 1); `PEDIDO_SELECT`/`mapPedido` não são exportados — usar a query nova abaixo.
- Produces: resposta JSON `{ estacao: { nome, modo }, pedidos: Pedido[] }`. Adiciona em `lib/queries/pedidos.ts` a função `listarPedidosPorStatus(admin, restauranteId, status: StatusPedido[]): Promise<Pedido[]>`.

- [ ] **Step 1: Adicionar query `listarPedidosPorStatus` em `lib/queries/pedidos.ts`**

Logo após `listarPedidosKanban` (perto da linha 171). Reusa `PEDIDO_SELECT` e `mapPedido` que já existem no arquivo:

```typescript
/** Pedidos de uma loja num conjunto de status — usado pelo portal da cozinha (admin client). */
export async function listarPedidosPorStatus(
  supabase: SupabaseClient,
  restauranteId: string,
  status: StatusPedido[]
): Promise<Pedido[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .in('status', status)
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}
```

- [ ] **Step 2: Escrever a rota**

```typescript
// app/api/cozinha/[token]/route.ts
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken, registrarHeartbeatEstacao } from '@/lib/queries/estacoes'
import { listarPedidosPorStatus } from '@/lib/queries/pedidos'
import { statusVisiveis } from '@/lib/cozinha/modo'

/** Portal da cozinha: pedidos visíveis para a estação, por token público (sem login). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    await registrarHeartbeatEstacao(admin, estacao.id).catch(() => {})
    const pedidos = await listarPedidosPorStatus(admin, estacao.restauranteId, statusVisiveis(estacao.modo))

    return NextResponse.json({
      estacao: { nome: estacao.nome, modo: estacao.modo, restauranteNome: estacao.restauranteNome },
      pedidos,
    })
  } catch {
    return NextResponse.json({ error: 'Erro ao carregar a estação' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "api/cozinha|listarPedidosPorStatus" || echo "OK"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add lib/queries/pedidos.ts app/api/cozinha/[token]/route.ts
git commit -m "feat(cozinha): rota GET do portal (pedidos por modo + heartbeat)"
```

---

### Task 4: Rota POST de ação (gate por modo + tenant)

Executa aceitar / pronto / entregue, validando que o modo permite **e** que o pedido é da loja da estação.

**Files:**
- Create: `app/api/cozinha/[token]/pedidos/[id]/acao/route.ts`

**Interfaces:**
- Consumes: `buscarEstacaoPorToken` (Task 2); `podeExecutar`, `transicaoDe`, `AcaoCozinha` (Task 1); `avancarStatusPedido`, `marcarPedidoEntregue` (existentes, `lib/queries/pedidos.ts`); `getAdminSupabase()`.
- Produces: `{ ok: true }` em sucesso; `403` se o modo não permite; `404` token inválido; `409` se o pedido não pertence à loja ou não está num status coerente.

- [ ] **Step 1: Escrever a rota**

```typescript
// app/api/cozinha/[token]/pedidos/[id]/acao/route.ts
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { podeExecutar, transicaoDe, type AcaoCozinha } from '@/lib/cozinha/modo'
import { avancarStatusPedido, marcarPedidoEntregue } from '@/lib/queries/pedidos'

const ACOES_VALIDAS: AcaoCozinha[] = ['aceitar', 'pronto', 'entregue']

export async function POST(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  const body = await request.json().catch(() => ({}))
  const acao = body.acao as AcaoCozinha
  if (!ACOES_VALIDAS.includes(acao)) return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    // Gate por modo.
    if (!podeExecutar(estacao.modo, acao)) {
      return NextResponse.json({ error: 'Esta estação não pode executar essa ação' }, { status: 403 })
    }

    // Segurança: confirma que o pedido é da loja da estação (admin client ignora RLS).
    const { data: pedido } = await admin.from('pedidos').select('id, restaurante_id, tipo, status').eq('id', id).maybeSingle()
    if (!pedido || pedido.restaurante_id !== estacao.restauranteId) {
      return NextResponse.json({ error: 'Pedido não encontrado nesta loja' }, { status: 409 })
    }

    // 'entregue' só faz sentido para retirada (entrega vira responsabilidade da logística).
    if (acao === 'entregue' && pedido.tipo !== 'retirada') {
      return NextResponse.json({ error: 'Pedido de entrega é despachado pela Logística' }, { status: 409 })
    }

    const { status, viaEntregue } = transicaoDe(acao)
    if (viaEntregue) await marcarPedidoEntregue(admin, id)
    else await avancarStatusPedido(admin, id, status)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o pedido' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "api/cozinha" || echo "OK"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add app/api/cozinha/[token]/pedidos/[id]/acao/route.ts
git commit -m "feat(cozinha): rota POST de ação com gate por modo + verificação de tenant"
```

---

### Task 5: Página do Kanban da cozinha

View restrita, tablet/celular-first, polling 6s, alerta sonoro de pedido novo.

**Files:**
- Create: `app/cozinha/[token]/page.tsx`

**Interfaces:**
- Consumes: rota `GET /api/cozinha/${token}` e `POST /api/cozinha/${token}/pedidos/${id}/acao`; tipo `Pedido` de `lib/queries/pedidos.ts`; `LABEL_MODO`, `type ModoEstacao` de `lib/cozinha/modo.ts`.
- Produces: rota pública `/cozinha/[token]`.

- [ ] **Step 1: Escrever a página**

```tsx
// app/cozinha/[token]/page.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Check, ChefHat, PackageCheck } from 'lucide-react'
import { LABEL_MODO, type ModoEstacao } from '@/lib/cozinha/modo'
import type { Pedido } from '@/lib/queries/pedidos'

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

interface PortalCozinha {
  estacao: { nome: string; modo: ModoEstacao; restauranteNome: string }
  pedidos: Pedido[]
}

/** Botão que cada status oferece, conforme o tipo do pedido. */
function acaoDoPedido(p: Pedido): { acao: 'aceitar' | 'pronto' | 'entregue'; label: string } | null {
  if (p.status === 'recebido') return { acao: 'aceitar', label: 'Aceitar' }
  if (p.status === 'preparando') return { acao: 'pronto', label: 'Pronto' }
  if (p.status === 'pronto' && p.tipo === 'retirada') return { acao: 'entregue', label: 'Entregue' }
  return null
}

export default function CozinhaPortalPage() {
  const { token } = useParams() as { token: string }
  const [data, setData] = useState<PortalCozinha | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const idsAnteriores = useRef<Set<string>>(new Set())
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/cozinha/${token}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Link inválido'); return }

      // Toca alerta se chegou pedido que não estava na lista anterior.
      const idsAgora = new Set<string>(json.pedidos.map((p: Pedido) => p.id))
      const temNovo = [...idsAgora].some((id) => !idsAnteriores.current.has(id))
      if (temNovo && idsAnteriores.current.size > 0) audioRef.current?.play().catch(() => {})
      idsAnteriores.current = idsAgora

      setData(json)
      setError(null)
    } catch {
      setError('Não foi possível carregar a estação.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, 6000)
    return () => clearInterval(interval)
  }, [refetch])

  async function executar(p: Pedido, acao: string) {
    setBusy(p.id)
    try {
      const res = await fetch(`/api/cozinha/${token}/pedidos/${p.id}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      if (!res.ok) { const j = await res.json(); setError(j.error ?? 'Falhou'); return }
      await refetch()
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-page text-text-subtle">Carregando…</div>
  if (error) return <div className="grid min-h-screen place-items-center bg-page p-6 text-center text-danger">{error}</div>
  if (!data) return null

  const mostraEndereco = data.estacao.modo === 'expedicao'

  return (
    <div className="min-h-screen bg-page">
      {/* Alerta sonoro curto (data-URI beep). */}
      <audio ref={audioRef} src="data:audio/wav;base64,UklGRl9vAAAAAA==" preload="auto" />

      <header className="sticky top-0 z-10 flex items-center justify-between bg-sidebar-bg px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <ChefHat className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold">{data.estacao.nome}</p>
            <p className="text-[11px] text-sidebar-text">{data.estacao.restauranteNome} · {LABEL_MODO[data.estacao.modo]}</p>
          </div>
        </div>
        <span className="rounded-menuzia bg-sidebar-hover px-2 py-1 text-[11px] font-semibold">{data.pedidos.length} pedidos</span>
      </header>

      <main className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.pedidos.map((p) => {
          const acao = acaoDoPedido(p)
          return (
            <article key={p.id} className="rounded-menuzia border border-border-color bg-main p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold">#{p.numero ?? p.id.slice(0, 4)}</span>
                <span className="rounded-menuzia bg-page px-2 py-0.5 text-[10px] font-semibold uppercase text-text-subtle">
                  {p.tipo === 'retirada' ? 'Retirada' : 'Entrega'}
                </span>
              </div>
              <p className="mb-1 text-sm font-medium">{p.clienteNome}</p>
              <ul className="mb-2 space-y-0.5 text-[13px] text-text-main">
                {p.itens.map((i, idx) => (
                  <li key={idx}>{i.quantidade}x {i.nome}</li>
                ))}
              </ul>
              {mostraEndereco && (
                <p className="mb-2 text-[12px] text-text-subtle">
                  {p.enderecoRua} · {p.formaPagamento}{p.trocoPara ? ` · troco p/ ${brl(p.trocoPara)}` : ''}
                </p>
              )}
              {acao && (
                <button
                  disabled={busy === p.id}
                  onClick={() => executar(p, acao.acao)}
                  className="flex w-full items-center justify-center gap-1 rounded-menuzia bg-status-ready py-3 text-[12px] font-semibold uppercase tracking-wide text-white disabled:opacity-50"
                >
                  {acao.acao === 'entregue' ? <PackageCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                  {acao.label}
                </button>
              )}
              {!acao && p.tipo === 'entrega' && p.status === 'pronto' && (
                <p className="text-center text-[11px] font-semibold uppercase text-text-subtle">Na logística</p>
              )}
            </article>
          )
        })}
        {data.pedidos.length === 0 && (
          <p className="col-span-full py-16 text-center text-text-subtle">Nenhum pedido nesta etapa agora.</p>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Conferir campos do tipo `Pedido`**

Os campos usados (`numero`, `clienteNome`, `itens[].quantidade/nome`, `tipo`, `enderecoRua`, `formaPagamento`, `trocoPara`) devem existir na interface `Pedido` (`lib/queries/pedidos.ts:26`). Abrir o arquivo e conferir os nomes exatos; ajustar no código se algum diferir (ex.: `enderecoRua` pode ser outro nome — usar `enderecoCompletoPedido(p)` se preferir).

Run: `npx tsc --noEmit 2>&1 | grep -E "cozinha/\[token\]" || echo "OK"`
Expected: `OK` (corrigir nomes de campo até zerar).

- [ ] **Step 3: Commit**

```bash
git add app/cozinha/[token]/page.tsx
git commit -m "feat(cozinha): página do Kanban restrito por estação (polling + alerta)"
```

---

### Task 6: Seção "Estações de cozinha" no painel Ajustes

Gestão das estações: criar, listar com link/QR, online, ativar/desativar, rotacionar token, excluir.

**Files:**
- Modify: `app/admin/ajustes/page.tsx`

**Interfaces:**
- Consumes: `listarEstacoes`, `criarEstacao`, `atualizarEstacao`, `rotacionarTokenEstacao`, `removerEstacao`, `type Estacao` (Task 2); `MODOS`, `LABEL_MODO`, `type ModoEstacao` (Task 1); `QRCode` de `'qrcode'` (já dependência); `getBrowserSupabase()`; `buscarRestauranteIdDoUsuario`.

- [ ] **Step 1: Conferir o padrão de QR existente**

Abrir `app/admin/logistica/page.tsx` perto da linha 220 (`portalUrl`) e onde `QRCode` é usado, para copiar o mesmo jeito de gerar a imagem do QR e montar a URL (`${window.location.origin}/cozinha/${token}`). Reusar o mesmo componente/markup de "link do entregador" adaptado.

- [ ] **Step 2: Adicionar estado + carregamento das estações**

No componente da página de Ajustes, junto dos outros `useState`/efeitos, adicionar:

```tsx
const [estacoes, setEstacoes] = useState<Estacao[]>([])
const [novaEstacaoNome, setNovaEstacaoNome] = useState('')
const [novaEstacaoModo, setNovaEstacaoModo] = useState<ModoEstacao>('producao')

const carregarEstacoes = useCallback(async (rid: string) => {
  setEstacoes(await listarEstacoes(supabase, rid))
}, [supabase])

useEffect(() => {
  if (!restauranteId) return
  carregarEstacoes(restauranteId)
  const t = setInterval(() => carregarEstacoes(restauranteId), 10000) // atualiza bolinha online
  return () => clearInterval(t)
}, [restauranteId, carregarEstacoes])
```

(Usar o nome real da variável do id da loja já presente no arquivo — pode ser `restauranteId` ou similar; conferir.)

- [ ] **Step 3: Handlers**

```tsx
async function handleCriarEstacao() {
  if (!restauranteId || !novaEstacaoNome.trim()) return
  await criarEstacao(supabase, restauranteId, novaEstacaoNome, novaEstacaoModo)
  setNovaEstacaoNome('')
  await carregarEstacoes(restauranteId)
}
async function handleToggleEstacao(e: Estacao) {
  await atualizarEstacao(supabase, e.id, { ativo: !e.ativo })
  if (restauranteId) await carregarEstacoes(restauranteId)
}
async function handleRotacionar(e: Estacao) {
  await rotacionarTokenEstacao(supabase, e.id)
  if (restauranteId) await carregarEstacoes(restauranteId)
}
async function handleRemoverEstacao(e: Estacao) {
  if (!confirm(`Remover a estação "${e.nome}"? O link atual deixa de funcionar.`)) return
  await removerEstacao(supabase, e.id)
  if (restauranteId) await carregarEstacoes(restauranteId)
}
```

- [ ] **Step 4: Markup da seção**

Adicionar dentro da aba "Impressão"/"Equipe" mais próxima, ou criar um novo bloco/card seguindo o padrão visual das outras seções de Ajustes (card branco, borda `border-border-color`, título). Conteúdo:
- Form de criação: input nome + `<select>` de modo (`MODOS.map` com `LABEL_MODO`) + botão "Criar estação".
- Lista de estações: por item → nome, `LABEL_MODO[modo]`, bolinha online (`e.online ? bg-status-ready : bg-text-subtle`), link `/cozinha/{token}` com botão copiar, QR (mesmo gerador da logística), botões "Ativar/Desativar", "Novo link" (rotacionar), "Excluir".

```tsx
<section className="rounded-menuzia border border-border-color bg-main p-4">
  <h3 className="mb-1 text-sm font-semibold">Estações de cozinha</h3>
  <p className="mb-4 text-[13px] text-text-subtle">
    Crie um acesso por link/QR para a cozinha usar no celular ou tablet. Cada estação vê só a sua etapa.
  </p>

  <div className="mb-4 flex flex-wrap items-end gap-2">
    <input
      value={novaEstacaoNome}
      onChange={(e) => setNovaEstacaoNome(e.target.value)}
      placeholder="Nome (ex.: Chapa, Expedição)"
      className="h-9 flex-1 rounded-menuzia border border-border-color px-3 text-sm"
    />
    <select
      value={novaEstacaoModo}
      onChange={(e) => setNovaEstacaoModo(e.target.value as ModoEstacao)}
      className="h-9 rounded-menuzia border border-border-color px-2 text-sm"
    >
      {MODOS.map((m) => <option key={m} value={m}>{LABEL_MODO[m]}</option>)}
    </select>
    <button onClick={handleCriarEstacao} className="h-9 rounded-menuzia bg-primary px-4 text-[11px] font-semibold uppercase text-white">
      Criar estação
    </button>
  </div>

  <ul className="space-y-2">
    {estacoes.map((e) => (
      <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-menuzia border border-border-color p-3">
        <span className={`h-2 w-2 rounded-full ${e.online ? 'bg-status-ready' : 'bg-text-subtle'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{e.nome} <span className="text-text-subtle">· {LABEL_MODO[e.modo]}</span></p>
          <button
            onClick={() => navigator.clipboard.writeText(`${window.location.origin}/cozinha/${e.token}`)}
            className="truncate text-[12px] text-primary"
          >
            {`${typeof window !== 'undefined' ? window.location.origin : ''}/cozinha/${e.token}`} — copiar
          </button>
        </div>
        <button onClick={() => handleToggleEstacao(e)} className="text-[11px] font-semibold uppercase text-text-subtle">
          {e.ativo ? 'Desativar' : 'Ativar'}
        </button>
        <button onClick={() => handleRotacionar(e)} className="text-[11px] font-semibold uppercase text-warn">Novo link</button>
        <button onClick={() => handleRemoverEstacao(e)} className="text-[11px] font-semibold uppercase text-danger">Excluir</button>
      </li>
    ))}
    {estacoes.length === 0 && <li className="py-4 text-center text-[13px] text-text-subtle">Nenhuma estação criada ainda.</li>}
  </ul>
</section>
```

(O QR pode ser adicionado reusando exatamente o gerador da logística — opcional nesta primeira passada; o link copiável já destrava o uso.)

- [ ] **Step 5: Adicionar imports no topo de `ajustes/page.tsx`**

```tsx
import { listarEstacoes, criarEstacao, atualizarEstacao, rotacionarTokenEstacao, removerEstacao, type Estacao } from '@/lib/queries/estacoes'
import { MODOS, LABEL_MODO, type ModoEstacao } from '@/lib/cozinha/modo'
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep -E "ajustes/page" || echo "OK"`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add app/admin/ajustes/page.tsx
git commit -m "feat(cozinha): seção de estações no painel Ajustes (criar, link/QR, online, token)"
```

---

### Task 7: Build de verificação + memória

- [ ] **Step 1: Build completo**

Run: `npm run build`
Expected: `BUILD OK` (sem erros). Corrigir o que aparecer antes de seguir.

- [ ] **Step 2: Rodar a suíte de testes**

Run: `npm test`
Expected: testes de `lib/cozinha/modo.test.ts` passam; nada quebrado.

- [ ] **Step 3: Teste manual (checklist do spec)**

1. Ajustes → criar estação "Produção teste" modo Produção → copiar link → abrir em aba anônima → ver só Recebido/Preparando → aceitar e marcar pronto → conferir reflexo em `/admin/pedidos` em tempo real.
2. Criar estação Expedição → abrir → tentar `POST .../acao {acao:'aceitar'}` via devtools → esperar **403**.
3. Desativar a estação → recarregar o link → **404**. Rotacionar token → link antigo **404**, novo funciona.
4. Conferir que login, painel principal e portal do entregador seguem normais.

- [ ] **Step 4: Atualizar memória**

Criar `C:\Users\felipe\.claude\projects\C--projetos-cardapio\memory\project_estacoes_cozinha.md` (type project) resumindo: tabela `estacoes`, modos, rotas `/cozinha/{token}`, gate server-side, migration 0029, gestão em Ajustes. Adicionar linha no `MEMORY.md`. Linkar `[[project-menuzia-status]]`.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore(cozinha): verificação de build + memória do projeto de estações"
```

---

## Notas de execução

- **Commit + push:** após validar tudo (build + testes + manual), `git push` para `main` (deploy é manual no Coolify pelo dono). Confirma com o usuário antes do push se ele preferir.
- **Sequenciamento:** Tasks 1→2→3→4 são back-end e independentes da UI; 5 e 6 são front-end e dependem de 2/3/4. Dá pra revisar entre cada uma.
- **Risco principal:** nomes de campos do tipo `Pedido` na página (Task 5) — conferir contra `lib/queries/pedidos.ts:26` e ajustar. Sem isso o `tsc` acusa.
