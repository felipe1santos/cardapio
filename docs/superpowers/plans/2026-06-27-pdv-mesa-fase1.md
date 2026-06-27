# PDV (Serviço de Mesa) — Fase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma tela de PDV (frente de caixa / serviço de mesa) onde o atendente lança pedidos por mesa que caem no Kanban e nas cozinhas em tempo real, marcados com tag de origem `PDV` + número da mesa.

**Architecture:** Tudo aditivo. A migration só adiciona colunas com default e uma tabela `mesas`. `criarPedido` (já usado pela vitrine) ganha campos opcionais `origem`/`mesa` com default que reproduz o comportamento atual. O PDV é uma página client em `/admin/pdv` que carrega o cardápio com `listarItens`, monta a comanda e posta numa nova route admin que reusa `criarPedido` com service_role. A tag aparece nos cards porque `PEDIDO_SELECT`/`mapPedido` (ponto central usado por Kanban, cozinha, logística e rotas) passam a trazer `origem`/`mesa`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind (design system Menuzia), Supabase (Postgres + RLS + Realtime), Vitest.

## Global Constraints

- **Fonte:** Inter (mesma do painel de despacho de rotas) — é a fonte global do app, não introduzir outra.
- **Paleta:** somente os tokens Menuzia definidos no CLAUDE.md (seção 3). Sem cores novas fora da paleta.
- **Radius:** `--radius-max: 3px` (classe `rounded-menuzia`); circulares só onde já é o padrão.
- **Não quebrar o existente:** migration idempotente (`add column if not exists`, `create table if not exists`), enums `forma_pagamento` e `tipo_pedido` **não mudam**, campos novos em `criarPedido` são opcionais com default.
- **Aplicação de migration remota:** `npm run db:setup` está quebrado neste projeto; aplicar SQL direto via pg (DATABASE_URL do `.env.local`). Confirmar com o usuário antes de aplicar em produção.
- **Multi-tenant:** toda query nova filtra por `restaurante_id`; tabela nova tem RLS por tenant.
- **Verificação:** o sandbox bloqueia rede pro Supabase — testes de navegador/queries contra o banco real não rodam aqui. O gate de cada task de UI/route é `tsc --noEmit` + `npm run build` limpos; a validação funcional é manual no ambiente real (Coolify), seguindo o padrão do projeto. Unit tests cobrem só lógica pura.

## File Structure

- `supabase/migrations/0032_pdv_mesas.sql` — **Criar.** Colunas `pedidos.origem`/`pedidos.mesa` + tabela `mesas` + RLS.
- `lib/queries/pedidos.ts` — **Modificar.** Tipos `Pedido`/`PedidoRow`, `PEDIDO_SELECT`, `mapPedido`, `NovoPedidoInput`, `criarPedido`.
- `lib/queries/mesas.ts` — **Criar.** CRUD de mesas + tipo `Mesa`.
- `lib/queries/mesas.test.ts` — **Criar.** Unit test do mapeamento puro.
- `app/admin/ajustes/page.tsx` — **Modificar.** Nova aba "Mesas" (`TabMesas`).
- `app/api/admin/pdv/pedido/route.ts` — **Criar.** POST autenticado por sessão admin → `criarPedido`.
- `app/admin/pdv/page.tsx` — **Criar.** Tela do PDV (focus-mode).
- `app/admin/layout.tsx` — **Modificar.** Item "PDV" em `NAV_ITEMS`.
- `components/layout/sidebar.tsx` — **Modificar.** Ícone de `/admin/pdv` em `NAV_ICONS`.
- `app/admin/pedidos/page.tsx` — **Modificar.** Tag PDV + Mesa no card.
- `app/cozinha/[token]/page.tsx` — **Modificar.** Tag PDV + Mesa no card.
- `CLAUDE.md` — **Modificar.** Nota fixa de paleta/fonte no início da seção 3.

---

### Task 1: Migration + propagação de `origem`/`mesa` no domínio de pedidos

**Files:**
- Create: `supabase/migrations/0032_pdv_mesas.sql`
- Modify: `lib/queries/pedidos.ts` (tipos `Pedido` ~L27, `PedidoRow` ~L70, `PEDIDO_SELECT` ~L111, `mapPedido` ~L119, `NovoPedidoInput` ~L799, `criarPedido` insert ~L933)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `Pedido.origem: 'cardapio' | 'pdv'` e `Pedido.mesa: string | null` (disponíveis em todos os consumidores de `mapPedido`).
  - `NovoPedidoInput.origem?: 'cardapio' | 'pdv'` (default `'cardapio'`) e `NovoPedidoInput.mesa?: string`.
  - `criarPedido` grava `origem` e `mesa`.

- [ ] **Step 1: Criar a migration**

Create `supabase/migrations/0032_pdv_mesas.sql`:

```sql
-- PDV (serviço de mesa) — Fase 1. Tudo aditivo e idempotente.

-- Origem do pedido (rastreio de onde veio): 'cardapio' (vitrine/manual) | 'pdv'
alter table pedidos add column if not exists origem text not null default 'cardapio';

-- Mesa do pedido PDV (snapshot do nome da mesa no momento do lançamento)
alter table pedidos add column if not exists mesa text;

-- Cadastro de mesas por loja
create table if not exists mesas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references restaurantes(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

create index if not exists idx_mesas_restaurante on mesas(restaurante_id);

alter table mesas enable row level security;

-- Acesso pela sessão do usuário dono do restaurante (mesmo padrão das demais tabelas do tenant).
drop policy if exists mesas_tenant_rw on mesas;
create policy mesas_tenant_rw on mesas
  for all
  using (restaurante_id in (select restaurante_id from usuarios where id = auth.uid()))
  with check (restaurante_id in (select restaurante_id from usuarios where id = auth.uid()));

grant select, insert, update, delete on mesas to authenticated;
```

> Antes de escrever o `using`/`with check`, abra `supabase/migrations/0001_init_multitenant.sql` e copie o **mesmo predicado de tenant** usado nas policies de `itens_cardapio`/`pedidos` (a forma exata de mapear `auth.uid()` → `restaurante_id` pode diferir do exemplo acima, ex.: tabela `usuarios` vs `restaurante_usuarios`). Use o predicado real do projeto, não o literal acima.

- [ ] **Step 2: Adicionar os campos aos tipos `Pedido` e `PedidoRow`**

Em `lib/queries/pedidos.ts`, no `interface Pedido` (após `telefoneVerificado: boolean`):

```ts
  origem: 'cardapio' | 'pdv'
  mesa: string | null
```

No `interface PedidoRow` (após `telefone_verificado: boolean`):

```ts
  origem: 'cardapio' | 'pdv'
  mesa: string | null
```

- [ ] **Step 3: Trazer os campos no select e no map**

Em `PEDIDO_SELECT`, acrescentar `origem, mesa` na lista de colunas (ex.: na linha de `... telefone_verificado, criado_em, atualizado_em,` deixar `... telefone_verificado, origem, mesa, criado_em, atualizado_em,`).

Em `mapPedido`, após `telefoneVerificado: row.telefone_verificado ?? true,`:

```ts
    origem: (row.origem as 'cardapio' | 'pdv') ?? 'cardapio',
    mesa: row.mesa ?? null,
```

- [ ] **Step 4: Estender `NovoPedidoInput` e a inserção em `criarPedido`**

No `interface NovoPedidoInput`, após `taxaEntrega?: number`:

```ts
  /** Origem do pedido. Default 'cardapio' (vitrine/manual). PDV manda 'pdv'. */
  origem?: 'cardapio' | 'pdv'
  /** Nome da mesa — só usado quando origem === 'pdv'. */
  mesa?: string
```

No `.insert({ ... })` de `criarPedido`, após `observacao: '',`:

```ts
      origem: input.origem ?? 'cardapio',
      mesa: input.origem === 'pdv' ? (input.mesa ?? null) : null,
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Aplicar a migration no banco**

Aplicar `0032_pdv_mesas.sql` direto via pg (DATABASE_URL do `.env.local`), **após confirmar com o usuário**. Conferir que as colunas e a tabela existem:

Run (psql): `\d mesas` e `\d pedidos`
Expected: `mesas` existe; `pedidos` tem `origem` e `mesa`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0032_pdv_mesas.sql lib/queries/pedidos.ts
git commit -m "feat(pdv): coluna origem/mesa em pedidos + tabela mesas (migration aditiva)"
```

---

### Task 2: Query lib de mesas (`lib/queries/mesas.ts`)

**Files:**
- Create: `lib/queries/mesas.ts`
- Test: `lib/queries/mesas.test.ts`

**Interfaces:**
- Consumes: nada do banco que a Task 1 não tenha criado (tabela `mesas`).
- Produces:
  - `type Mesa = { id: string; nome: string; ordem: number; ativa: boolean }`
  - `mapMesaRow(row): Mesa` (pura, testável)
  - `listarMesas(supabase, restauranteId): Promise<Mesa[]>` (todas, ordenadas por `ordem`)
  - `listarMesasAtivas(supabase, restauranteId): Promise<Mesa[]>` (só `ativa=true`)
  - `criarMesa(supabase, restauranteId, { nome, ordem }): Promise<Mesa>`
  - `atualizarMesa(supabase, id, patch: Partial<{ nome: string; ordem: number; ativa: boolean }>): Promise<void>`
  - `removerMesa(supabase, id): Promise<void>`

- [ ] **Step 1: Escrever o teste do mapeamento puro**

Create `lib/queries/mesas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapMesaRow } from './mesas'

describe('mapMesaRow', () => {
  it('mapeia uma linha do banco para Mesa', () => {
    const row = { id: 'm1', restaurante_id: 'r1', nome: 'Mesa 1', ordem: 2, ativa: true, criado_em: 'x' }
    expect(mapMesaRow(row)).toEqual({ id: 'm1', nome: 'Mesa 1', ordem: 2, ativa: true })
  })

  it('trata ativa ausente como true', () => {
    const row = { id: 'm2', restaurante_id: 'r1', nome: 'Balcão', ordem: 0, ativa: null, criado_em: 'x' }
    expect(mapMesaRow(row).ativa).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run lib/queries/mesas.test.ts`
Expected: FAIL — `mapMesaRow` não existe / módulo não encontrado.

- [ ] **Step 3: Implementar `lib/queries/mesas.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Mesa {
  id: string
  nome: string
  ordem: number
  ativa: boolean
}

interface MesaRow {
  id: string
  restaurante_id: string
  nome: string
  ordem: number
  ativa: boolean | null
  criado_em: string
}

export function mapMesaRow(row: MesaRow): Mesa {
  return { id: row.id, nome: row.nome, ordem: row.ordem, ativa: row.ativa ?? true }
}

export async function listarMesas(supabase: SupabaseClient, restauranteId: string): Promise<Mesa[]> {
  const { data, error } = await supabase
    .from('mesas')
    .select('id, restaurante_id, nome, ordem, ativa, criado_em')
    .eq('restaurante_id', restauranteId)
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as MesaRow[]).map(mapMesaRow)
}

export async function listarMesasAtivas(supabase: SupabaseClient, restauranteId: string): Promise<Mesa[]> {
  return (await listarMesas(supabase, restauranteId)).filter((m) => m.ativa)
}

export async function criarMesa(
  supabase: SupabaseClient,
  restauranteId: string,
  input: { nome: string; ordem: number },
): Promise<Mesa> {
  const { data, error } = await supabase
    .from('mesas')
    .insert({ restaurante_id: restauranteId, nome: input.nome, ordem: input.ordem })
    .select('id, restaurante_id, nome, ordem, ativa, criado_em')
    .single()
  if (error) throw error
  return mapMesaRow(data as MesaRow)
}

export async function atualizarMesa(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<{ nome: string; ordem: number; ativa: boolean }>,
): Promise<void> {
  const { error } = await supabase.from('mesas').update(patch).eq('id', id)
  if (error) throw error
}

export async function removerMesa(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('mesas').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run lib/queries/mesas.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/mesas.ts lib/queries/mesas.test.ts
git commit -m "feat(pdv): query lib de mesas (CRUD + mapMesaRow)"
```

---

### Task 3: Aba "Mesas" em Ajustes

**Files:**
- Modify: `app/admin/ajustes/page.tsx` (tipo `Tab` ~L46, lista de tabs ~L49, render dos componentes ~L1770)

**Interfaces:**
- Consumes: `listarMesas`, `criarMesa`, `atualizarMesa`, `removerMesa`, `type Mesa` (Task 2). `getBrowserSupabase` e o padrão de `TabXxx({ restauranteId, active })` já usado no arquivo.
- Produces: aba "Mesas" funcional (cadastro consumido pela Task 5).

- [ ] **Step 1: Estudar o padrão de aba existente**

Ler em `app/admin/ajustes/page.tsx` um componente de aba simples já existente (ex.: `TabEntrega` ou o CRUD de taxas por bairro) para copiar exatamente o estilo visual (inputs, botões `Button`, badges, `rounded-menuzia`) e o padrão de carregar dados quando `active` vira true.

- [ ] **Step 2: Adicionar 'mesas' ao tipo `Tab` e à lista de abas**

No `type Tab` (L46), acrescentar `| 'mesas'`. Na lista de tabs (array com `{ id, label }`), adicionar `{ id: 'mesas', label: 'Mesas' }` numa posição coerente (ex.: após `entrega`).

- [ ] **Step 3: Implementar o componente `TabMesas`**

Adicionar no arquivo um componente seguindo o padrão das outras abas (mesma assinatura `{ restauranteId, active }`). Comportamento:
- Ao `active`, `listarMesas(getBrowserSupabase(), restauranteId)` → estado `mesas`.
- Campo "Nome da mesa" + botão "Adicionar" → `criarMesa` (ordem = `mesas.length`) → recarrega.
- Cada linha: nome editável (blur → `atualizarMesa(.., { nome })`), toggle Ativa/Pausada (`atualizarMesa(.., { ativa })`, badge verde/cinza do design system), botão excluir (`removerMesa` com `confirm`).
- Estado vazio: texto "Nenhuma mesa cadastrada ainda."

Usar somente componentes/estilos já presentes (`Button`, `Badge`, classes Tailwind do design system). Sem libs novas.

- [ ] **Step 4: Renderizar a aba**

Junto aos outros `<TabXxx ... active={tab === '...'} />` (~L1770), adicionar:

```tsx
<TabMesas restauranteId={restauranteId} active={tab === 'mesas'} />
```

- [ ] **Step 5: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 6: Verificação manual (ambiente real)**

Em `/admin/ajustes` → aba "Mesas": cadastrar 2 mesas, renomear uma, pausar/reativar, excluir. Confirmar persistência ao recarregar.

- [ ] **Step 7: Commit**

```bash
git add app/admin/ajustes/page.tsx
git commit -m "feat(pdv): aba Mesas em Ajustes (cadastro de mesas)"
```

---

### Task 4: Route de lançamento do PDV (`/api/admin/pdv/pedido`)

**Files:**
- Create: `app/api/admin/pdv/pedido/route.ts`

**Interfaces:**
- Consumes: `getServerSupabase` (`lib/supabase/server.ts`), `buscarRestauranteIdDoUsuario` (`lib/queries/cardapio.ts`), `getAdminSupabase` (`lib/supabase/admin.ts`), `criarPedido` + `NovoPedidoInput` (Task 1).
- Produces: `POST /api/admin/pdv/pedido` → `{ id, numero }` (201) ou `{ error }` (400/401). Consumido pela Task 5.

- [ ] **Step 1: Implementar a route**

Create `app/api/admin/pdv/pedido/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'

export async function POST(request: Request) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  let body: NovoPedidoInput
  try {
    body = (await request.json()) as NovoPedidoInput
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  // Força a origem PDV no servidor (o cliente não decide isso).
  const input: NovoPedidoInput = { ...body, origem: 'pdv', tipo: 'retirada' }

  const admin = getAdminSupabase()
  try {
    const pedido = await criarPedido(admin, restauranteId, input)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
```

> Confirme as assinaturas exatas de `getServerSupabase` e `buscarRestauranteIdDoUsuario` nos arquivos citados antes de finalizar (a primeira é `async`; a segunda recebe um `SupabaseClient` e retorna `string | null`).

- [ ] **Step 2: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos (route compila).

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/pdv/pedido/route.ts
git commit -m "feat(pdv): route admin de lançamento de pedido (origem=pdv, autenticada por sessão)"
```

---

### Task 5: Tela do PDV (`/admin/pdv`) + item na sidebar

**Files:**
- Create: `app/admin/pdv/page.tsx`
- Modify: `app/admin/layout.tsx` (`NAV_ITEMS` ~L11)
- Modify: `components/layout/sidebar.tsx` (`NAV_ICONS` ~L17)

**Interfaces:**
- Consumes: `getBrowserSupabase`, `buscarRestauranteIdDoUsuario`, `listarItens` + `type ItemCardapio` (`lib/queries/cardapio.ts`), `listarMesasAtivas` + `type Mesa` (Task 2), `POST /api/admin/pdv/pedido` (Task 4), tipo `NovoPedidoItemInput` (`lib/queries/pedidos.ts`). Evento `menuzia:focus-mode` (já tratado em `app/admin/layout.tsx`).
- Produces: tela `/admin/pdv` que lança pedidos.

- [ ] **Step 1: Adicionar o item de navegação**

Em `app/admin/layout.tsx`, no `NAV_ITEMS`, após `{ href: '/admin/pedidos', label: 'Painel de Pedidos' }`:

```ts
  { href: '/admin/pdv', label: 'PDV' },
```

- [ ] **Step 2: Adicionar o ícone**

Em `components/layout/sidebar.tsx`, no `NAV_ICONS`, adicionar a entrada (ícone de monitor/caixa do mesmo "estilo path" dos demais):

```ts
  '/admin/pdv': 'M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h6v2H8v2h8v-2h-2v-2h6c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z',
```

- [ ] **Step 3: Implementar a página do PDV**

Create `app/admin/pdv/page.tsx` (client component). Estrutura mínima exigida:

- `'use client'`; no mount dispara `window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: true }))` e no unmount `detail: false` (espelha `app/admin/pedidos/page.tsx:273-293`).
- Resolve `restauranteId` via `buscarRestauranteIdDoUsuario(getBrowserSupabase())`.
- Carrega `listarItens(supabase, restauranteId)` (cardápio) e `listarMesasAtivas(supabase, restauranteId)` (mesas).
- **Coluna Mesas:** grade de botões com as mesas ativas + botão "Balcão" (mesa = `null`). Seleção controla `mesaSelecionada: Mesa | null` e uma flag `mesaEscolhida` (Balcão também conta como escolha explícita).
- **Coluna Cardápio:** busca por nome + chips de categoria; clicar num item simples adiciona direto à comanda. Para itens com complementos obrigatórios / tamanho / sabor (pizza), abrir um seletor antes de adicionar.
  - Reuso: o seletor de produto da vitrine vive em `app/loja/[slug]/page.tsx`. Extrair a lógica de montagem de uma linha `NovoPedidoItemInput` (tamanho/sabor/borda/massa/complementos/observação/quantidade) para um componente reutilizável **ou**, se o esforço de extração for grande, implementar no PDV um seletor próprio que produza exatamente um `NovoPedidoItemInput`. Não duplicar regra de preço — o preço final é recalculado no servidor por `criarPedido`.
- **Coluna Comanda:** lista das linhas adicionadas (nome, tamanho/sabor, complementos, qtd com stepper, remover), subtotal exibido só como referência visual, botão **"Lançar na cozinha"** (desabilitado se comanda vazia ou mesa não escolhida).
- **Lançar:** monta o body e posta:

```ts
const body = {
  tipo: 'retirada' as const,
  origem: 'pdv' as const,
  mesa: mesaSelecionada?.nome,            // undefined no Balcão
  cliente: { nome: nomeCliente.trim() || 'Cliente Balcão', telefone: '' },
  endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
  pagamento: 'dinheiro' as const,         // placeholder; pago=false; forma real só na Fase 3
  trocoPara: null,
  itens,                                  // NovoPedidoItemInput[]
}
const res = await fetch('/api/admin/pdv/pedido', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
```
  - Sucesso (201): limpa a comanda, mantém a mesa, feedback "Pedido #N lançado na {Mesa/Balcão}".
  - Erro: exibe `error` retornado, mantém a comanda.
- **Estilo:** Inter + paleta Menuzia, `rounded-menuzia`, componentes `Button`/`Badge` existentes. Layout responsivo (3 colunas em desktop; em telas estreitas, mesas e comanda viram painéis recolhíveis/abas — manter usável no mobile).

- [ ] **Step 4: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 5: Verificação manual (ambiente real)**

Em `/admin/pdv`: selecionar mesa, adicionar itens (incluindo um com complemento e, se houver, uma pizza), lançar. Confirmar toast de sucesso e comanda limpa. Confirmar que a sidebar some (focus-mode) e volta ao sair.

- [ ] **Step 6: Commit**

```bash
git add app/admin/pdv/page.tsx app/admin/layout.tsx components/layout/sidebar.tsx
git commit -m "feat(pdv): tela de frente de caixa (lançamento por mesa) + item na sidebar"
```

---

### Task 6: Tag de origem `PDV` + mesa nos cards (Kanban + Cozinha)

**Files:**
- Modify: `app/admin/pedidos/page.tsx` (card do Kanban; render perto de `PAY_LABEL[order.formaPagamento]` ~L582)
- Modify: `app/cozinha/[token]/page.tsx` (card; perto de `pedido.tipo === 'retirada' ? 'Retirada' : 'Entrega'` ~L243 e ~L375)

**Interfaces:**
- Consumes: `Pedido.origem` e `Pedido.mesa` (Task 1, já disponíveis via `PEDIDO_SELECT`/`mapPedido`).
- Produces: tag visível nos cards quando `origem === 'pdv'`.

- [ ] **Step 1: Tag no card do Kanban**

Em `app/admin/pedidos/page.tsx`, no card, adicionar quando `order.origem === 'pdv'` um badge `PDV` + chip da mesa. Usar `Badge` do design system. Onde hoje mostra a forma de pagamento (`PAY_LABEL[order.formaPagamento]`, ~L582), para `order.origem === 'pdv'` mostrar `Mesa {order.mesa ?? 'Balcão'} · conta aberta` em vez do badge de pagamento (pedido de mesa paga no fim — Fase 3). Exemplo:

```tsx
{order.origem === 'pdv' ? (
  <span className="text-[11px] font-semibold text-text-subtle">
    Mesa {order.mesa ?? 'Balcão'} · conta aberta
  </span>
) : (
  <span>{PAY_LABEL[order.formaPagamento]}</span>
)}
```

E uma tag de origem perto do `#numero`/tipo do card:

```tsx
{order.origem === 'pdv' && <Badge tone="info">PDV</Badge>}
```

> Conferir o nome da prop/tones de `components/ui/badge.tsx` antes (ex.: `tone="info"`/`"new"`); usar uma tone existente que renda destaque sem cor fora da paleta.

- [ ] **Step 2: Tag no card da Cozinha**

Em `app/cozinha/[token]/page.tsx`, nos dois pontos de render do tipo (~L243 e ~L375, `pedido.tipo === 'retirada' ? 'Retirada' : 'Entrega'`), acrescentar ao lado, quando `pedido.origem === 'pdv'`, um chip `PDV · Mesa {pedido.mesa ?? 'Balcão'}` com o mesmo estilo de badge usado nesse arquivo. Não remover o indicador de tipo existente.

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 4: Verificação manual (ambiente real)**

Lançar um pedido pelo PDV (mesa "3") e abrir `/admin/pedidos` e `/cozinha/[token]`: o card deve mostrar a tag `PDV` + `Mesa 3`. Um pedido feito pela vitrine deve continuar **sem** tag. Confirmar que o card PDV aparece em tempo real (sem refresh).

- [ ] **Step 5: Commit**

```bash
git add app/admin/pedidos/page.tsx app/cozinha/[token]/page.tsx
git commit -m "feat(pdv): tag de origem PDV + mesa nos cards do Kanban e das cozinhas"
```

---

### Task 7: Nota fixa de paleta/fonte no CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (início da seção "3. Identidade visual / Design System")

**Interfaces:**
- Consumes: nada.
- Produces: lembrete permanente de paleta/fonte.

- [ ] **Step 1: Inserir a nota**

No início da seção 3 do `CLAUDE.md` (logo após o título da seção, antes de "### Paleta de cores"), inserir:

```markdown
> **⚠️ Paleta e fonte oficiais — sempre seguir em qualquer alteração visual.**
> A paleta de cores abaixo e a fonte **Inter** (a mesma usada no painel de despacho
> de rotas e em todo o app) são o padrão oficial da Menuzia. Toda mudança de UI em
> qualquer módulo — incluindo o **PDV** — deve usar exatamente estas cores, a fonte
> Inter e o radius `3px`. Não introduzir cores ou fontes fora desta paleta.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: fixar paleta/fonte oficiais no topo do design system (lembrete permanente)"
```

---

## Self-Review

**Spec coverage:**
- Migration `origem`/`mesa` + tabela `mesas` → Task 1.
- CRUD/cadastro de mesas → Task 2 + Task 3.
- `criarPedido` estendido sem quebrar vitrine → Task 1 (default `'cardapio'`).
- Tela PDV focus-mode, Inter/paleta, mesa+comanda, lançar → Task 5.
- Reuso do caminho `criarPedido` via route autenticada → Task 4.
- Tag PDV + Mesa no Kanban e cozinhas → Task 6.
- Vitrine sem tag → garantido pelo default e pelo `order.origem === 'pdv'` guard (Task 6).
- Nota de paleta/fonte no CLAUDE.md → Task 7.
- Enums intactos / `pago=false` / `tipo='retirada'` → Task 1 + Task 4.

**Placeholder scan:** sem "TBD/TODO". Os pontos de "confirmar assinatura/policy/tone antes" são verificações de integração contra arquivos reais existentes, não trabalho indefinido.

**Type consistency:** `Pedido.origem`/`Pedido.mesa` (Task 1) usados em Task 6; `NovoPedidoInput.origem/mesa` (Task 1) usados em Task 4/5; `Mesa`/`listarMesasAtivas` (Task 2) usados em Task 3/5; `NovoPedidoItemInput` (existente) usado em Task 5. Nomes batem entre as tasks.

**Fora de escopo (Fases 2/3):** fechar mesa, agrupar pedidos por mesa, total por mesa, forma de pagamento no fechamento, controle de caixa, tag `Manual`.
