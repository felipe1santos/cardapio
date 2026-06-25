# Cozinha Produção v2 (claim, modal de preparo, cronômetro, redesign) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Transformar o painel da cozinha num fluxo de produção real: cozinheiro se identifica, pega o pedido (claim atômico), prepara num modal tela-cheia com adicionais em verde e restrições em vermelho caixa-alta, devolve ou conclui; o admin vê quem preparou; cronômetro de urgência; e redesign da seção de estações em Ajustes.

**Architecture:** Continua o padrão de estação por token (sem login). Identidade do cozinheiro é um nome digitado e guardado no `localStorage`, enviado nas ações. Claim é atômico via `update ... where status='recebido'`. Reusa as rotas/admin client já existentes; estende `pedidos` com 2 colunas.

**Tech Stack:** Next.js (App Router) · Supabase (admin client) · Tailwind · vitest · qrcode (`^1.5.4`, já instalado, usado em `app/admin/logistica/page.tsx`).

## Global Constraints

- Identidade Menuzia: Inter, `rounded-menuzia` (3px). Classe de borda do design system é **`border-border`** (NÃO `border-border-color`). Cores de status: `bg-status-pending`/`text-status-pending` (laranja=recebido), `bg-status-preparing`/`text-status-preparing` (azul=preparando), `bg-status-ready`/`text-status-ready` (verde=pronto). Verde de adicionais: `text-status-ready` ou `text-price-text`. Vermelho de restrição: `text-danger`. Botões caixa-alta 11px.
- **Adicionais (complementos) sempre em VERDE. Observação/restrição do cliente sempre em VERMELHO, CAIXA ALTA.** Isso vale no card e no modal — é requisito anti-erro de cozinha.
- Token validado server-side com admin client. Ação confere tenant (`pedido.restaurante_id === estacao.restauranteId`) antes de mutar.
- **Claim atômico:** pegar um pedido só pode mudar `recebido → preparando` via `update ... where id=? and status='recebido'`; 0 linhas afetadas = outro cozinheiro já pegou → 409.
- Nome do cozinheiro obrigatório para `pegar` e `concluir` (body `cozinheiro`); vazio → 400.
- Notificações WhatsApp como hoje: `pegar`(→preparando) e `concluir`(→pronto) disparam `notificarPedido(admin, id, status)` de `@/lib/whatsapp`, fire-and-forget.
- Test runner: `npm test` (vitest). Build: `npm run build`.
- NÃO quebrar: portal do entregador, login, e o modo `expedicao` da cozinha (que segue só `entregue`).

## File Structure

- `supabase/migrations/0030_cozinha_preparo.sql` — add `preparando_por`, `preparado_por` em `pedidos`. (CRIAR)
- `lib/queries/pedidos.ts` — add os 2 campos em `Pedido`/`PedidoRow`/`PEDIDO_SELECT`/`mapPedido`; add helpers `pegarPedidoCozinha`, `devolverPedidoCozinha`, `concluirPedidoCozinha`. (MODIFICAR)
- `lib/cozinha/modo.ts` + `.test.ts` — novas ações `pegar/devolver/concluir/entregue`, `ORIGEM_ESPERADA`, ajustar testes. (MODIFICAR)
- `app/api/cozinha/[token]/pedidos/[id]/acao/route.ts` — novas ações, claim, nome, notify. (REESCREVER)
- `app/cozinha/[token]/page.tsx` — reescrita: prompt de nome, 2 colunas, cronômetro, modal de preparo. (REESCREVER)
- `app/admin/pedidos/page.tsx` — exibir "Preparado por". (MODIFICAR)
- `app/admin/ajustes/page.tsx` — redesign do `TabEstacoes` (QR, copiar, cores, link truncado). (MODIFICAR)

---

### Task 1: Migration 0030 + campos e helpers de preparo em pedidos.ts

**Files:**
- Create: `supabase/migrations/0030_cozinha_preparo.sql`
- Modify: `lib/queries/pedidos.ts`

**Interfaces:**
- Produces (em `lib/queries/pedidos.ts`):
  - `Pedido` ganha `preparandoPor: string | null` e `preparadoPor: string | null`.
  - `pegarPedidoCozinha(admin, pedidoId, cozinheiro): Promise<boolean>` — claim atômico; true se pegou, false se já estava pego.
  - `devolverPedidoCozinha(admin, pedidoId): Promise<void>` — preparando→recebido, limpa `preparando_por`.
  - `concluirPedidoCozinha(admin, pedidoId, cozinheiro): Promise<void>` — preparando→pronto, grava `preparado_por`.

- [ ] **Step 1: Migration**

```sql
-- supabase/migrations/0030_cozinha_preparo.sql
-- Rastreio de preparo na cozinha: quem pegou o pedido (claim) e quem concluiu.
alter table pedidos
  add column preparando_por text,
  add column preparado_por text;
```

- [ ] **Step 2: Estender o mapeamento de Pedido**

Em `lib/queries/pedidos.ts`: adicionar à interface `Pedido` (perto da linha 45, antes de `itens`):
```typescript
  preparandoPor: string | null
  preparadoPor: string | null
```
Adicionar à interface `PedidoRow` os campos crus `preparando_por: string | null` e `preparado_por: string | null`. Adicionar `preparando_por, preparado_por` à constante `PEDIDO_SELECT`. Em `mapPedido`, mapear `preparandoPor: row.preparando_por ?? null` e `preparadoPor: row.preparado_por ?? null`. (Abrir o arquivo e seguir o padrão exato dos outros campos.)

- [ ] **Step 3: Helpers de claim/devolver/concluir**

Adicionar perto das outras mutations (após `avancarStatusPedido`, ~linha 213):
```typescript
/** Claim atômico de um pedido pela cozinha: só pega se ainda estiver 'recebido'. Retorna se conseguiu. */
export async function pegarPedidoCozinha(admin: SupabaseClient, pedidoId: string, cozinheiro: string): Promise<boolean> {
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: 'preparando', preparando_por: cozinheiro })
    .eq('id', pedidoId)
    .eq('status', 'recebido')
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/** Devolve o pedido pego para o pool (volta a 'recebido', limpa quem estava preparando). */
export async function devolverPedidoCozinha(admin: SupabaseClient, pedidoId: string): Promise<void> {
  const { error } = await admin
    .from('pedidos')
    .update({ status: 'recebido', preparando_por: null })
    .eq('id', pedidoId)
    .eq('status', 'preparando')
  if (error) throw error
}

/** Conclui o preparo: 'preparando' → 'pronto', registra quem preparou. */
export async function concluirPedidoCozinha(admin: SupabaseClient, pedidoId: string, cozinheiro: string): Promise<void> {
  const { error } = await admin
    .from('pedidos')
    .update({ status: 'pronto', preparado_por: cozinheiro })
    .eq('id', pedidoId)
    .eq('status', 'preparando')
  if (error) throw error
}
```

- [ ] **Step 4: Verificar + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "pedidos.ts" || echo "OK"` → esperar OK.
```bash
git add supabase/migrations/0030_cozinha_preparo.sql lib/queries/pedidos.ts
git commit -m "feat(cozinha): campos preparando_por/preparado_por + helpers de claim/devolver/concluir"
```

- [ ] **Step 5: Aplicar no banco remoto (nota p/ o humano)**

Você NÃO acessa o banco remoto. Deixe registrado no report que o humano deve rodar no SQL editor do Supabase:
```sql
alter table pedidos add column preparando_por text, add column preparado_por text;
```

---

### Task 2: modo.ts v2 — ações pegar/devolver/concluir/entregue

**Files:**
- Modify: `lib/cozinha/modo.ts`
- Modify: `lib/cozinha/modo.test.ts`

**Interfaces:**
- Produces:
  - `type AcaoCozinha = 'pegar' | 'devolver' | 'concluir' | 'entregue'`
  - `statusVisiveis(modo)` — inalterado (producao/completa veem recebido+preparando; expedicao vê pronto).
  - `podeExecutar(modo, acao)` — producao: pegar/devolver/concluir; expedicao: entregue; completa: todas.
  - `ORIGEM_ESPERADA: Record<AcaoCozinha, StatusPedido>` = `{ pegar:'recebido', devolver:'preparando', concluir:'preparando', entregue:'pronto' }`.
  - `MODOS`, `LABEL_MODO` — inalterados.
  - REMOVER `transicaoDe` (não é mais usado; a rota chama helpers específicos).

- [ ] **Step 1: Reescrever os testes** (`lib/cozinha/modo.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { statusVisiveis, podeExecutar, ORIGEM_ESPERADA, MODOS, LABEL_MODO } from './modo'

describe('statusVisiveis', () => {
  it('producao vê recebido e preparando', () => { expect(statusVisiveis('producao')).toEqual(['recebido', 'preparando']) })
  it('expedicao vê só pronto', () => { expect(statusVisiveis('expedicao')).toEqual(['pronto']) })
  it('completa vê recebido, preparando e pronto', () => { expect(statusVisiveis('completa')).toEqual(['recebido', 'preparando', 'pronto']) })
})

describe('podeExecutar', () => {
  it('producao pega/devolve/conclui, não entrega', () => {
    expect(podeExecutar('producao', 'pegar')).toBe(true)
    expect(podeExecutar('producao', 'devolver')).toBe(true)
    expect(podeExecutar('producao', 'concluir')).toBe(true)
    expect(podeExecutar('producao', 'entregue')).toBe(false)
  })
  it('expedicao só entrega', () => {
    expect(podeExecutar('expedicao', 'entregue')).toBe(true)
    expect(podeExecutar('expedicao', 'pegar')).toBe(false)
    expect(podeExecutar('expedicao', 'concluir')).toBe(false)
  })
  it('completa faz tudo', () => {
    for (const a of ['pegar', 'devolver', 'concluir', 'entregue'] as const) expect(podeExecutar('completa', a)).toBe(true)
  })
})

describe('ORIGEM_ESPERADA', () => {
  it('mapeia cada ação ao status de origem', () => {
    expect(ORIGEM_ESPERADA).toEqual({ pegar: 'recebido', devolver: 'preparando', concluir: 'preparando', entregue: 'pronto' })
  })
})

describe('metadados', () => {
  it('lista os 3 modos com rótulos', () => {
    expect(MODOS).toEqual(['producao', 'expedicao', 'completa'])
    expect(LABEL_MODO.producao).toBe('Produção')
  })
})
```

- [ ] **Step 2: Rodar (deve falhar)** — `npx vitest run lib/cozinha/modo.test.ts` → FAIL (ORIGEM_ESPERADA/ações novas não existem).

- [ ] **Step 3: Reescrever `lib/cozinha/modo.ts`**

```typescript
// lib/cozinha/modo.ts
// Lógica pura do acesso da cozinha por estação: o que cada modo VÊ e o que pode FAZER.
import type { StatusPedido } from '@/lib/queries/pedidos'

export type ModoEstacao = 'producao' | 'expedicao' | 'completa'
export type AcaoCozinha = 'pegar' | 'devolver' | 'concluir' | 'entregue'

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
  producao: ['pegar', 'devolver', 'concluir'],
  expedicao: ['entregue'],
  completa: ['pegar', 'devolver', 'concluir', 'entregue'],
}

/** Status de origem exigido para cada ação (guarda contra cliques velhos/concorrentes). */
export const ORIGEM_ESPERADA: Record<AcaoCozinha, StatusPedido> = {
  pegar: 'recebido',
  devolver: 'preparando',
  concluir: 'preparando',
  entregue: 'pronto',
}

export function statusVisiveis(modo: ModoEstacao): StatusPedido[] {
  return STATUS_POR_MODO[modo]
}

export function podeExecutar(modo: ModoEstacao, acao: AcaoCozinha): boolean {
  return ACOES_POR_MODO[modo].includes(acao)
}
```

- [ ] **Step 4: Rodar (deve passar)** — `npx vitest run lib/cozinha/modo.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/cozinha/modo.ts lib/cozinha/modo.test.ts
git commit -m "feat(cozinha): modo v2 com ações pegar/devolver/concluir + ORIGEM_ESPERADA"
```

---

### Task 3: Rota de ação v2 (claim, nome, notify)

**Files:**
- Modify (reescrever): `app/api/cozinha/[token]/pedidos/[id]/acao/route.ts`

**Interfaces:**
- Consumes: `buscarEstacaoPorToken`; `podeExecutar`, `ORIGEM_ESPERADA`, `type AcaoCozinha`; `pegarPedidoCozinha`, `devolverPedidoCozinha`, `concluirPedidoCozinha`, `marcarPedidoEntregue` (pedidos.ts); `notificarPedido` (`@/lib/whatsapp`); `getAdminSupabase()`.
- Body: `{ acao, cozinheiro?: string }`. `cozinheiro` obrigatório (não-vazio) para `pegar` e `concluir`.

- [ ] **Step 1: Reescrever a rota**

```typescript
// app/api/cozinha/[token]/pedidos/[id]/acao/route.ts
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { podeExecutar, ORIGEM_ESPERADA, type AcaoCozinha } from '@/lib/cozinha/modo'
import {
  pegarPedidoCozinha,
  devolverPedidoCozinha,
  concluirPedidoCozinha,
  marcarPedidoEntregue,
} from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/whatsapp'

const ACOES_VALIDAS: AcaoCozinha[] = ['pegar', 'devolver', 'concluir', 'entregue']

export async function POST(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  const body = await request.json().catch(() => ({}))
  const acao = body.acao as AcaoCozinha
  const cozinheiro = typeof body.cozinheiro === 'string' ? body.cozinheiro.trim() : ''
  if (!ACOES_VALIDAS.includes(acao)) return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  if ((acao === 'pegar' || acao === 'concluir') && !cozinheiro) {
    return NextResponse.json({ error: 'Informe o nome do cozinheiro' }, { status: 400 })
  }

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })
    if (!podeExecutar(estacao.modo, acao)) return NextResponse.json({ error: 'Esta estação não pode executar essa ação' }, { status: 403 })

    const { data: pedido } = await admin.from('pedidos').select('id, restaurante_id, tipo, status').eq('id', id).maybeSingle()
    if (!pedido || pedido.restaurante_id !== estacao.restauranteId) {
      return NextResponse.json({ error: 'Pedido não encontrado nesta loja' }, { status: 409 })
    }
    if (pedido.status !== ORIGEM_ESPERADA[acao]) {
      return NextResponse.json({ error: 'O pedido já mudou de etapa' }, { status: 409 })
    }
    if (acao === 'entregue' && pedido.tipo !== 'retirada') {
      return NextResponse.json({ error: 'Pedido de entrega é despachado pela Logística' }, { status: 409 })
    }

    if (acao === 'pegar') {
      const pego = await pegarPedidoCozinha(admin, id, cozinheiro)
      if (!pego) return NextResponse.json({ error: 'Outro cozinheiro já pegou esse pedido' }, { status: 409 })
      notificarPedido(admin, id, 'preparando').catch(() => {})
    } else if (acao === 'devolver') {
      await devolverPedidoCozinha(admin, id)
    } else if (acao === 'concluir') {
      await concluirPedidoCozinha(admin, id, cozinheiro)
      notificarPedido(admin, id, 'pronto').catch(() => {})
    } else {
      await marcarPedidoEntregue(admin, id)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o pedido' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verificar + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "api/cozinha" || echo "OK"` → OK.
```bash
git add app/api/cozinha/[token]/pedidos/[id]/acao/route.ts
git commit -m "feat(cozinha): rota de ação v2 (pegar com claim atômico, devolver, concluir, nome do cozinheiro)"
```

---

### Task 4: Página da cozinha — reescrita (nome, 2 colunas, cronômetro, modal de preparo)

**Files:**
- Modify (reescrever): `app/cozinha/[token]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/cozinha/${token}` (resposta `{ estacao:{nome,modo,restauranteNome}, pedidos: Pedido[] }`); `POST /api/cozinha/${token}/pedidos/${id}/acao` body `{acao, cozinheiro}`; `Pedido`/`PedidoItem` de `lib/queries/pedidos.ts`; `LABEL_MODO`, `type ModoEstacao` de `lib/cozinha/modo.ts`.

**Requisitos exatos (modo producao e completa):**
- **Prompt de nome:** ao montar, ler `localStorage` chave `cozinha:nome:{token}`. Se vazio, mostrar um overlay simples pedindo "Qual o seu nome?" com input + botão "Entrar". Salvar no localStorage. Mostrar o nome no header com um botão "trocar" que limpa e reabre o prompt. Sem nome, não dá pra pegar/concluir.
- **Polling 6s** (mantém). Beep em pedido novo na coluna Disponíveis (mantém o AudioContext atual).
- **2 colunas:**
  - **Disponíveis** = pedidos com `status === 'recebido'`, ordenados por `criadoEm` ascendente (mais antigo = mais urgente, primeiro). Card: `#{numero}`, nome do cliente, resumo dos itens (`{q}x {nome}`), **cronômetro** (ver abaixo), botão grande **"Pegar para fazer"** → POST `{acao:'pegar', cozinheiro}` → ao 200 abre o modal desse pedido; ao 409 mostra aviso "já foi pego" e refetch.
  - **Em preparo** = `status === 'preparando'`. Card mostra `#{numero}`, cliente, **"Em preparo por {preparandoPor}"**, cronômetro. Clicar no card reabre o modal.
- **Cronômetro/urgência** (componente interno): tempo decorrido desde `criadoEm`, formato `mm:ss` (ou `h:mm` se >60min), com **ícone de relógio (lucide `Clock`/`AlarmClock`) piscando** (`animate-pulse`). Cor por faixa: ≤10min `text-status-ready` (verde), ≤20min `text-status-pending` (laranja), >20min `text-danger` (vermelho). Atualiza a cada 1s (um `useEffect` com `setInterval` que força re-render via `useState` de "agora").
- **Modal de preparo** (abre ao pegar ou ao clicar um card "em preparo"):
  - **Tela cheia no celular** (`fixed inset-0`), **modal grande no notebook** (em `sm:` vira card centralizado grande, ex. `sm:max-w-2xl`). Fundo `bg-main`, scroll interno.
  - Cabeçalho: `#{numero}` + cliente + tipo (retirada/entrega) + cronômetro.
  - **Observação geral do pedido** (`pedido.observacao`), se houver: **VERMELHO CAIXA ALTA** (`text-danger uppercase font-bold`), destacada num bloco `bg-danger-bg`.
  - Lista de itens: para cada `item` → `{quantidade}x {nome}`; se `tamanhoNome`/`saborNome`/`bordaNome`/`massaNome` houver, mostrar como sub-linha; **complementos (adicionais) em VERDE** (`text-status-ready`, ex. "+ Bacon", "+ Queijo"); **`item.observacao` em VERMELHO CAIXA ALTA** (`text-danger uppercase font-bold`).
  - Botões fixos no rodapé: **"Devolver"** (variante neutra/escura) → `confirm('Tem certeza que quer devolver este pedido?')` → POST `{acao:'devolver'}` → fecha modal + refetch. **"Concluir pedido"** (verde) → POST `{acao:'concluir', cozinheiro}` → fecha modal + refetch.
  - O modal **só fecha** por Devolver ou Concluir (não por clicar fora / sem botão de X que apenas fecha). Se o cozinheiro fechar a aba e voltar, o pedido continua em "Em preparo" e ele reabre clicando no card.
- **Modo expedicao:** manter a visão simples atual (lista de pronto + botão Entregue para retirada / "Na logística" para entrega). Só adaptar o tipo de ação se necessário — expedicao NÃO usa pegar/concluir.
- Estados loading / erro / vazio em cada coluna. Identidade Menuzia, tablet/celular-first.

- [ ] **Step 1: Reescrever a página** seguindo TODOS os requisitos acima. Ler a versão atual de `app/cozinha/[token]/page.tsx` e o portal do entregador `app/entregador/[token]/page.tsx` para tom/estrutura. Usar os nomes EXATOS dos campos de `Pedido`/`PedidoItem` (preparandoPor, preparadoPor, observacao, complementos[].nome, tamanhoNome, saborNome, bordaNome, massaNome, numero, clienteNome, criadoEm, tipo, status).

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit 2>&1 | grep -E "cozinha/\[token\]" || echo "OK"` → OK (corrigir nomes de campo até zerar).

- [ ] **Step 3: Commit**
```bash
git add app/cozinha/[token]/page.tsx
git commit -m "feat(cozinha): página de produção (nome do cozinheiro, colunas disponíveis/em preparo, cronômetro, modal de preparo)"
```

---

### Task 5: Admin /admin/pedidos exibe "Preparado por"

**Files:**
- Modify: `app/admin/pedidos/page.tsx`

**Interfaces:**
- Consumes: `Pedido.preparadoPor` / `Pedido.preparandoPor` (já disponíveis após Task 1).

- [ ] **Step 1: Exibir quem preparou**

No card do pedido e/ou no drawer de detalhes, quando `preparadoPor` existir, mostrar uma linha discreta **"Preparado por: {preparadoPor}"** (ex. `text-[11px] text-text-subtle`). Quando `status === 'preparando'` e `preparandoPor` existir, mostrar **"Em preparo por: {preparandoPor}"**. Abrir o arquivo, localizar onde os metadados do card/detalhe são renderizados e inserir seguindo o padrão visual existente. Não alterar lógica de status/ações.

- [ ] **Step 2: Verificar + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "admin/pedidos" || echo "OK"` → OK.
```bash
git add app/admin/pedidos/page.tsx
git commit -m "feat(pedidos): exibe quem preparou/está preparando o pedido no painel admin"
```

---

### Task 6: Redesign da seção Estações (Ajustes › Cozinha)

**Files:**
- Modify: `app/admin/ajustes/page.tsx` (componente `TabEstacoes`)

**Interfaces:**
- Consumes: `QRCode` de `'qrcode'` (ver uso em `app/admin/logistica/page.tsx`); helpers de estação já existentes.

- [ ] **Step 1: Conferir o padrão de QR**

Ler `app/admin/logistica/page.tsx` onde `QRCode` (import linha 4) gera o QR do link do entregador (`QRCode.toDataURL(...)`). Reusar a mesma abordagem.

- [ ] **Step 2: Redesenhar cada card de estação**

Requisitos:
- **Link truncado dentro do card** (`truncate`, `min-w-0`, `overflow-hidden`) — nunca vazar pra fora.
- **Botão "Copiar"** com ícone (lucide `Copy`/`Check`) ao lado do link; feedback "Copiado!" por ~1.5s.
- **QR code** do link `${origin}/cozinha/${token}` (gerar via `QRCode.toDataURL` num `useState`/efeito por estação; exibir `<img>` ~120px) — pode ser num pop/expand "Ver QR" ou inline.
- **Cores fortes do modo** (badge): producao → `bg-status-pending/10 text-status-pending` (laranja), expedicao → `bg-status-preparing/10 text-status-preparing` (azul), completa → `bg-status-ready/10 text-status-ready` (verde). Bolinha online mantém `bg-status-ready`/`bg-text-subtle`.
- Layout organizado: header do card (bolinha + nome + badge modo + status online), corpo (link truncado + copiar + QR), rodapé (Ativar/Desativar, Novo link, Excluir) — sem nada vazando, espaçamento consistente, `rounded-menuzia`, `border-border`.
- Form de criação no topo (nome + select modo + criar) — manter, alinhado ao novo visual.

- [ ] **Step 3: Verificar + commit**

Run: `npx tsc --noEmit 2>&1 | grep -E "ajustes/page" || echo "OK"` → OK.
```bash
git add app/admin/ajustes/page.tsx
git commit -m "feat(cozinha): redesign das estações em Ajustes (link truncado, copiar, QR, cores por modo)"
```

---

### Task 7: Build + testes + memória

- [ ] **Step 1: Build** — `npm run build` → BUILD OK (corrigir o que aparecer).
- [ ] **Step 2: Testes** — `npm test` → modo.test.ts passa; nada quebrado.
- [ ] **Step 3: Teste manual** (checklist):
  1. Abrir estação producao → pedir nome → digitar.
  2. Pedido teste aparece em Disponíveis com cronômetro piscando.
  3. "Pegar para fazer" → abre modal tela cheia, observação em vermelho caixa alta, adicionais em verde.
  4. Dois navegadores pegando o mesmo pedido → o 2º recebe "já foi pego".
  5. Devolver (com confirm) → volta pra Disponíveis. Concluir → some da cozinha, vira pronto.
  6. `/admin/pedidos` mostra "Preparado por: {nome}".
  7. Ajustes › Cozinha: link não vaza, copiar funciona, QR aparece, cores por modo.
- [ ] **Step 4: Memória** — atualizar `project_estacoes_cozinha.md` com o fluxo v2 (claim, nome, modal, campos novos, migration 0030). Pointer no MEMORY.md já existe.
- [ ] **Step 5: Commit final** (se houver ajustes) + push para `main`.

---

## Notas de execução

- **Migration 0030:** o humano roda no Supabase (`alter table pedidos add column preparando_por text, add column preparado_por text;`). Sem RLS nova (pedidos já tem políticas).
- **Sequência:** 1→2→3→4 (back→front da cozinha); 5 depende de 1; 6 é independente. Ordem 1..6, depois 7.
- **Risco:** Task 4 é a maior (reescrita de UI). Conferir nomes de campo de `Pedido`/`PedidoItem` contra `lib/queries/pedidos.ts`.
