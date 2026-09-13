# Vitrine: banner com ponto de foco, fonte Rubik e modo gaveta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dobrar a altura do banner da vitrine e dar ao lojista controle do recorte, trocar a fonte da vitrine para Rubik, e acrescentar um terceiro modo de exibição do cardápio navegado por categoria com foto.

**Architecture:** O recorte é resolvido por um par de coordenadas percentuais gravadas no banco e consumidas como `object-position` — sem reprocessar imagem, e servindo celular e desktop com o mesmo arquivo. O modo novo entra como um terceiro valor de `layout_cardapio`, que já existe. A Rubik é escopada por um `layout.tsx` novo na rota da vitrine, deixando o painel em Inter.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres + Storage), Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-vitrine-banner-gaveta-design.md`

## Global Constraints

- Paleta fixa e `border-radius: 3px` (`rounded-menuzia`) exceto elementos genuinamente circulares — CLAUDE.md §3. Nenhuma cor fora da paleta. Nomes de classe existem no `tailwind.config.ts`: **confira lá antes de escrever** (`bg-alert-bg`, `text-alert-text`, `bg-main`, `bg-page`, `text-text-main`, `text-text-subtle`, `border-border`; `bg-bg-alert` e `bg-bg-main` **não existem**).
- **Proibido tocar em `printer-agent/`** ou em qualquer formatação de recibo — CLAUDE.md §7.
- Migrations aditivas e idempotentes (`add column if not exists`). Nunca converter formato de dado existente.
- **Default seguro:** todo campo novo nasce com o valor que reproduz o comportamento de hoje. `foco` nasce `50/50`, que é o `object-cover` centralizado atual.
- Mobile-first; a vitrine tem que seguir fluida em 390 px e resolvida em tablet/desktop.
- Testes: `npm test` (vitest). **Baseline antes da Task 1: 373 passed / 10 skipped.**
- Gate de tipagem: zero erro de tsc em arquivo **que não seja de teste**. Confira com:
  `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
  (~235 erros dentro de arquivos de teste são pré-existentes; ignore).
- **Não rodar `npm run build`, não subir o dev server, não conectar em banco, não rodar `scripts/setup-db.mjs`.** O controller aplica a migration.
- Não dar `git push`.
- Mensagem de commit: imperativa, sem emoji, terminando com:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012H5KaH9axrnAsheyqv6WpE
```

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0051_foco_imagem_categoria.sql` (criar) | colunas de foco na loja e foto+foco na categoria |
| `lib/foco-imagem.ts` (criar) | módulo puro: saturar foco, formatar `object-position` |
| `lib/foco-imagem.test.ts` (criar) | testes do módulo puro |
| `lib/queries/cardapio.ts` (modificar) | `'gaveta'` no tipo, foco na loja, foto+foco no grupo |
| `lib/queries/ajustes.ts` (modificar) | foco no config e no patch, `enviarImagemCategoria` |
| `components/seletor-foco.tsx` (criar) | a mira arrastável, usada em dois lugares |
| `app/admin/ajustes/page.tsx` (modificar) | mira da capa + opção "Gaveta" travada |
| `app/admin/cardapio/page.tsx` (modificar) | foto + mira no formulário de categoria |
| `app/loja/[slug]/vitrine.tsx` (modificar) | banner 2:1 com foco, modo gaveta, `font-vitrine` |
| `app/loja/[slug]/layout.tsx` (criar) | carrega Rubik só na rota da vitrine |
| `tailwind.config.ts` (modificar) | `fontFamily.vitrine` |
| `CLAUDE.md` (modificar) | registrar a exceção de fonte |
| `scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs` (criar) | semeia as 15 fotos de categoria da Pizza do Rosa |

---

### Task 1: Migration e módulo puro do ponto de foco

**Files:**
- Create: `supabase/migrations/0051_foco_imagem_categoria.sql`
- Create: `supabase/migrations/0051_foco_imagem_categoria.test.ts`
- Create: `lib/foco-imagem.ts`
- Create: `lib/foco-imagem.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - colunas `restaurantes.banner_foco_x`, `restaurantes.banner_foco_y` (`numeric(5,2) not null default 50`)
  - colunas `grupos_cardapio.imagem_url` (`text`), `grupos_cardapio.imagem_foco_x`, `grupos_cardapio.imagem_foco_y` (`numeric(5,2) not null default 50`)
  - `export interface Foco { x: number; y: number }`
  - `export const FOCO_PADRAO: Foco`
  - `export function focoValido(x: unknown, y: unknown): Foco`
  - `export function objectPosition(foco: Foco): string`

- [ ] **Step 1: Escrever os testes que falham**

Crie `supabase/migrations/0051_foco_imagem_categoria.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(aqui, '0051_foco_imagem_categoria.sql'), 'utf8')

describe('0051 foco de imagem e foto de categoria', () => {
  it('adiciona o foco da capa na loja, com default 50', () => {
    expect(sql).toMatch(/add column if not exists banner_foco_x numeric\(5, ?2\) not null default 50/)
    expect(sql).toMatch(/add column if not exists banner_foco_y numeric\(5, ?2\) not null default 50/)
  })

  it('adiciona foto e foco na categoria', () => {
    expect(sql).toMatch(/add column if not exists imagem_url text/)
    expect(sql).toMatch(/add column if not exists imagem_foco_x numeric\(5, ?2\) not null default 50/)
    expect(sql).toMatch(/add column if not exists imagem_foco_y numeric\(5, ?2\) not null default 50/)
  })

  it('50 é o centro — nenhuma loja existente muda de aparência', () => {
    expect(sql).not.toMatch(/update\s+restaurantes/i)
    expect(sql).not.toMatch(/update\s+grupos_cardapio/i)
  })

  it('é idempotente', () => {
    const adds = sql.match(/add column/g) ?? []
    const guards = sql.match(/add column if not exists/g) ?? []
    expect(guards.length).toBe(adds.length)
  })
})
```

Crie `lib/foco-imagem.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FOCO_PADRAO, focoValido, objectPosition, type Foco } from './foco-imagem'

describe('focoValido', () => {
  it('passa números dentro da faixa', () => {
    expect(focoValido(10, 90)).toEqual({ x: 10, y: 90 })
  })

  it('aceita string numérica — é o que o Postgres devolve pra numeric', () => {
    expect(focoValido('25.5', '75')).toEqual({ x: 25.5, y: 75 })
  })

  it('satura fora da faixa em vez de quebrar o layout', () => {
    expect(focoValido(-40, 180)).toEqual({ x: 0, y: 100 })
  })

  it('cai no centro pro que não é número', () => {
    expect(focoValido(null, undefined)).toEqual(FOCO_PADRAO)
    expect(focoValido('abc', {})).toEqual(FOCO_PADRAO)
    expect(focoValido(NaN, Infinity)).toEqual(FOCO_PADRAO)
  })

  it('o padrão é o centro — o mesmo que object-cover sem object-position', () => {
    expect(FOCO_PADRAO).toEqual({ x: 50, y: 50 })
  })
})

describe('objectPosition', () => {
  it('formata como a CSS espera', () => {
    expect(objectPosition({ x: 50, y: 50 })).toBe('50% 50%')
    expect(objectPosition({ x: 0, y: 100 })).toBe('0% 100%')
  })

  it('não deixa sobra de ponto flutuante virar string feia', () => {
    const f: Foco = { x: 33.333333, y: 66.666666 }
    expect(objectPosition(f)).toBe('33.33% 66.67%')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run lib/foco-imagem.test.ts supabase/migrations/0051_foco_imagem_categoria.test.ts`
Expected: FAIL — `Failed to resolve import "./foco-imagem"` e `ENOENT ... 0051_foco_imagem_categoria.sql`

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/0051_foco_imagem_categoria.sql`:

```sql
-- ============================================================================
-- Ponto de foco de imagem (capa da loja e foto de categoria) + foto de
-- categoria, que o modo de exibição "gaveta" consome.
--
-- O foco é um par de percentuais consumido como `object-position: X% Y%`.
-- 50/50 é exatamente o `object-cover` centralizado que a vitrine faz hoje,
-- então aplicar esta migration NÃO muda a aparência de nenhuma loja já
-- cadastrada. Quem arrastar a mira no painel é que muda.
--
-- `numeric(5,2)` porque o valor vem de uma fração da largura do elemento:
-- duas casas dão precisão de sub-pixel em qualquer tela e cabem folgado.
-- ============================================================================

alter table restaurantes
  add column if not exists banner_foco_x numeric(5,2) not null default 50,
  add column if not exists banner_foco_y numeric(5,2) not null default 50;

comment on column restaurantes.banner_foco_x is
  'Ponto de foco horizontal da capa, 0-100. 50 = centro (comportamento padrão).';
comment on column restaurantes.banner_foco_y is
  'Ponto de foco vertical da capa, 0-100. 50 = centro (comportamento padrão).';

-- Foto da categoria: só o modo "gaveta" exibe. NULL = categoria sem foto, que
-- é o que trava a escolha desse modo no painel.
alter table grupos_cardapio
  add column if not exists imagem_url text,
  add column if not exists imagem_foco_x numeric(5,2) not null default 50,
  add column if not exists imagem_foco_y numeric(5,2) not null default 50;

comment on column grupos_cardapio.imagem_url is
  'Foto do cartão da categoria no modo gaveta. NULL = sem foto.';
```

- [ ] **Step 4: Escrever o módulo puro**

Crie `lib/foco-imagem.ts`:

```ts
/**
 * Ponto de foco de uma imagem recortada por `object-fit: cover`.
 *
 * A capa da loja e o cartão de categoria são exibidos em proporções diferentes
 * conforme a largura da tela (2:1 no celular, bem mais largo no desktop). Um
 * recorte gravado no arquivo acertaria uma proporção e erraria a outra; um par
 * de coordenadas percentuais serve as duas com o mesmo arquivo, e ainda
 * funciona nas capas que já foram enviadas.
 */

export interface Foco {
  /** 0-100, percentual da largura. 0 = esquerda, 100 = direita. */
  x: number
  /** 0-100, percentual da altura. 0 = topo, 100 = base. */
  y: number
}

/** Centro — idêntico a um `object-cover` sem `object-position`. */
export const FOCO_PADRAO: Foco = { x: 50, y: 50 }

function eixo(v: unknown): number | null {
  // O Postgres devolve `numeric` como string; o formulário devolve string.
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, n))
}

/**
 * Satura na faixa 0-100 e cai no centro pro que não for número finito. O pior
 * caso de um dado corrompido é a imagem ancorada numa borda — nunca um
 * `object-position` inválido, que o navegador ignoraria inteiro.
 */
export function focoValido(x: unknown, y: unknown): Foco {
  const px = eixo(x)
  const py = eixo(y)
  if (px === null || py === null) return FOCO_PADRAO
  return { x: px, y: py }
}

/** Arredonda em 2 casas pra não emitir "33.333333333%" no style. */
export function objectPosition(foco: Foco): string {
  const r = (n: number) => String(Math.round(n * 100) / 100)
  return `${r(foco.x)}% ${r(foco.y)}%`
}
```

- [ ] **Step 5: Rodar e confirmar que passam**

Run: `npx vitest run lib/foco-imagem.test.ts supabase/migrations/0051_foco_imagem_categoria.test.ts`
Expected: PASS (10 testes)

- [ ] **Step 6: Suíte cheia e tipagem**

Run: `npm test`
Expected: 383 passed / 10 skipped (373 + 10 novos)

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0051_foco_imagem_categoria.sql supabase/migrations/0051_foco_imagem_categoria.test.ts lib/foco-imagem.ts lib/foco-imagem.test.ts
git commit -m "feat(vitrine): ponto de foco de imagem e foto de categoria"
```

---

### Task 2: Expor foco, foto de categoria e o modo gaveta nas queries

**Files:**
- Modify: `lib/queries/cardapio.ts` (`GrupoCardapio` linha 20; `GRUPO_SELECT` linha 199; `GrupoRow` linha 201; `mapGrupo` linha 210; `LayoutCardapio` linha 783; `RestauranteVitrine` linha 804; `buscarRestaurantePorSlug` linha 826)
- Modify: `lib/queries/ajustes.ts` (`CONFIG_SELECT` linha 81; mapeamento linha 105; patch linha 220)
- Create: `lib/queries/categoria-imagem.test.ts`

**Interfaces:**
- Consumes: `Foco`, `focoValido`, `FOCO_PADRAO` de `lib/foco-imagem.ts` (Task 1).
- Produces:
  - `LayoutCardapio = 'categoria' | 'lista' | 'gaveta'`
  - `GrupoCardapio` ganha `imagemUrl: string | null` e `imagemFoco: Foco`
  - `RestauranteVitrine` ganha `bannerFoco: Foco`
  - `ConfigLoja` (em ajustes) ganha `bannerFoco: Foco`; o patch aceita `bannerFoco?: Foco`
  - `atualizarGrupo(supabase, grupoId, nome, horario?, imagem?)` — a assinatura real de hoje é `(supabase, grupoId, nome, horario?)` com `horario` sendo `{ horarioAtivoInicio, horarioAtivoFim }`; o 5º parâmetro `imagem?: { url: string | null; foco: Foco }` é novo e **opcional**, omitido = imagem e foco não entram no update
  - `enviarImagemCategoria(supabase, restauranteId, file): Promise<string>`

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/queries/categoria-imagem.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { atualizarGrupo } from './cardapio'

/** Supabase falso que captura o payload do update. */
function supabaseFake() {
  const single = vi.fn().mockResolvedValue({ data: { id: 'g1' }, error: null })
  const select = vi.fn(() => ({ single }))
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { client: { from } as never, update }
}

describe('atualizarGrupo', () => {
  it('omite imagem e foco quando não recebe — editar o nome não apaga a foto', async () => {
    const { client, update } = supabaseFake()
    await atualizarGrupo(client, 'g1', 'Bebidas')
    const payload = update.mock.calls[0][0]
    expect(payload).not.toHaveProperty('imagem_url')
    expect(payload).not.toHaveProperty('imagem_foco_x')
    expect(payload).not.toHaveProperty('imagem_foco_y')
    expect(payload.nome).toBe('Bebidas')
  })

  it('grava imagem e foco quando recebe', async () => {
    const { client, update } = supabaseFake()
    await atualizarGrupo(client, 'g1', 'Bebidas', undefined, { url: 'https://x/y.webp', foco: { x: 20, y: 80 } })
    const payload = update.mock.calls[0][0]
    expect(payload.imagem_url).toBe('https://x/y.webp')
    expect(payload.imagem_foco_x).toBe(20)
    expect(payload.imagem_foco_y).toBe(80)
  })

  it('aceita limpar a foto passando null explícito', async () => {
    const { client, update } = supabaseFake()
    await atualizarGrupo(client, 'g1', 'Bebidas', undefined, { url: null, foco: { x: 50, y: 50 } })
    expect(update.mock.calls[0][0].imagem_url).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run lib/queries/categoria-imagem.test.ts`
Expected: FAIL — o primeiro teste falha porque `atualizarGrupo` hoje não tem os parâmetros novos e o payload não bate.

- [ ] **Step 3: Editar `lib/queries/cardapio.ts`**

No topo, junto aos outros imports:

```ts
import { focoValido, FOCO_PADRAO, type Foco } from '@/lib/foco-imagem'
```

`GrupoCardapio` (linha 20) ganha dois campos:

```ts
export interface GrupoCardapio {
  id: string
  nome: string
  posicao: number
  /** Ativação automática por horário (ex.: marmitaria de dia, pizza à noite). Ambos null = sempre ativa. */
  horarioAtivoInicio: string | null
  horarioAtivoFim: string | null
  /** Foto do cartão no modo de exibição "gaveta". NULL = categoria sem foto. */
  imagemUrl: string | null
  /** Ponto de foco da foto acima. Centro por padrão. */
  imagemFoco: Foco
}
```

`GRUPO_SELECT` (linha 199) e `GrupoRow` (linha 201):

```ts
const GRUPO_SELECT = 'id, nome, posicao, horario_ativo_inicio, horario_ativo_fim, imagem_url, imagem_foco_x, imagem_foco_y'

interface GrupoRow {
  id: string
  nome: string
  posicao: number
  horario_ativo_inicio: string | null
  horario_ativo_fim: string | null
  imagem_url: string | null
  imagem_foco_x: number | string | null
  imagem_foco_y: number | string | null
}
```

`mapGrupo` (linha 210):

```ts
function mapGrupo(row: GrupoRow): GrupoCardapio {
  return {
    id: row.id,
    nome: row.nome,
    posicao: row.posicao,
    horarioAtivoInicio: row.horario_ativo_inicio?.slice(0, 5) ?? null,
    horarioAtivoFim: row.horario_ativo_fim?.slice(0, 5) ?? null,
    imagemUrl: row.imagem_url ?? null,
    imagemFoco: focoValido(row.imagem_foco_x, row.imagem_foco_y),
  }
}
```

`atualizarGrupo` (linha 242) — a assinatura de hoje é `(supabase, grupoId, nome, horario?)`, onde `horario` é `{ horarioAtivoInicio, horarioAtivoFim }`. **Mantenha os quatro primeiros parâmetros como estão** e acrescente um quinto, opcional:

```ts
/**
 * `imagem` é opcional de propósito: quando não vem, `imagem_url` e o foco NÃO
 * entram no payload, então editar o nome ou o horário de uma categoria não
 * apaga a foto que ela já tem. Passar `{ url: null, foco }` é o jeito de
 * limpar a foto.
 */
export async function atualizarGrupo(
  supabase: SupabaseClient,
  grupoId: string,
  nome: string,
  horario?: { horarioAtivoInicio: string | null; horarioAtivoFim: string | null },
  imagem?: { url: string | null; foco: Foco },
) {
  const { data, error } = await supabase
    .from('grupos_cardapio')
    .update({
      nome,
      ...(horario
        ? { horario_ativo_inicio: horario.horarioAtivoInicio, horario_ativo_fim: horario.horarioAtivoFim }
        : {}),
      ...(imagem
        ? { imagem_url: imagem.url, imagem_foco_x: imagem.foco.x, imagem_foco_y: imagem.foco.y }
        : {}),
    })
    .eq('id', grupoId)
```

O resto do corpo da função (o que vem depois do `.eq('id', grupoId)`) fica exatamente como está.

`LayoutCardapio` (linha 783):

```ts
/** `gaveta` = navegação por categoria: cartão com foto, tocar entra na categoria. */
export type LayoutCardapio = 'categoria' | 'lista' | 'gaveta'
```

`RestauranteVitrine` (linha 804) ganha:

```ts
  /** Ponto de foco da capa — ancoragem do object-cover. */
  bannerFoco: Foco
```

Em `buscarRestaurantePorSlug` (linha 826), acrescente `banner_foco_x, banner_foco_y` à string do `.select(...)` e mapeie no retorno:

```ts
    bannerFoco: focoValido(data.banner_foco_x, data.banner_foco_y),
```

- [ ] **Step 4: Editar `lib/queries/ajustes.ts`**

Import no topo:

```ts
import { focoValido, type Foco } from '@/lib/foco-imagem'
```

`CONFIG_SELECT` (linha 81): acrescente `banner_foco_x, banner_foco_y` à lista.

Na interface de config (perto da linha 30), acrescente `bannerFoco: Foco`. No mapeamento (linha 105):

```ts
    bannerFoco: focoValido(row.banner_foco_x, row.banner_foco_y),
```

No tipo do patch (linha 151), acrescente `bannerFoco?: Foco`; na montagem do row (linha 220):

```ts
  if (patch.bannerFoco !== undefined) {
    row.banner_foco_x = patch.bannerFoco.x
    row.banner_foco_y = patch.bannerFoco.y
  }
```

E acrescente, ao lado de `enviarBannerLoja` (linha 402):

```ts
/** Foto do cartão de categoria no modo gaveta — mesma largura de produto (1200px). */
export async function enviarImagemCategoria(
  supabase: SupabaseClient,
  restauranteId: string,
  file: File,
): Promise<string> {
  const otimizada = await otimizarImagem(file, 'produto')
  return subirPerfil(supabase, restauranteId, 'categoria', otimizada)
}
```

Confirme que `otimizarImagem` já está importado nesse arquivo; se não estiver, acrescente ao import de `@/lib/imagem`.

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run lib/queries/categoria-imagem.test.ts`
Expected: PASS (3 testes)

Run: `npm test`
Expected: 386 passed / 10 skipped

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia. Se aparecer erro em `app/admin/cardapio/page.tsx` por causa de `GrupoCardapio` ter campos novos, é porque algum lugar constrói um `GrupoCardapio` literal — acrescente `imagemUrl: null, imagemFoco: FOCO_PADRAO` nesse literal.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/cardapio.ts lib/queries/ajustes.ts lib/queries/categoria-imagem.test.ts
git commit -m "feat(vitrine): foco da capa, foto de categoria e modo gaveta nas queries"
```

---

### Task 3: Componente da mira (`SeletorFoco`)

**Files:**
- Create: `components/seletor-foco.tsx`

**Interfaces:**
- Consumes: `Foco`, `objectPosition` de `lib/foco-imagem.ts` (Task 1).
- Produces: `export function SeletorFoco(props: { src: string; foco: Foco; onChange: (f: Foco) => void; proporcoes: { rotulo: string; ratio: number }[] })`

Sem teste automatizado: o repo não tem infraestrutura de teste de componente React (zero arquivos `.test.tsx`). A verificação é leitura + tsc + lint, e a conferência visual na Task 9.

- [ ] **Step 1: Escrever o componente**

Crie `components/seletor-foco.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { objectPosition, type Foco } from '@/lib/foco-imagem'

/**
 * Mira arrastável sobre uma imagem: o lojista marca o que NÃO pode ser cortado.
 *
 * Não sobe imagem e não salva — só emite o foco. Quem persiste é a tela que usa.
 * As molduras mostram, em cima da foto inteira, o pedaço que sobra em cada
 * proporção em que a imagem vai aparecer, porque a mesma foto é recortada
 * diferente no celular e no desktop.
 */
export function SeletorFoco({
  src,
  foco,
  onChange,
  proporcoes,
}: {
  src: string
  foco: Foco
  onChange: (f: Foco) => void
  proporcoes: { rotulo: string; ratio: number }[]
}) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const [arrastando, setArrastando] = useState(false)
  // Proporção real da foto, medida no onLoad. 2 é um chute que só vale até a
  // imagem carregar; a moldura se corrige sozinha no primeiro render depois.
  const [ratioFoto, setRatioFoto] = useState(2)

  function pontoDoEvento(clientX: number, clientY: number) {
    const el = caixaRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const x = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))
    const y = Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100))
    onChange({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })
  }

  function teclado(e: React.KeyboardEvent) {
    const passo = e.shiftKey ? 10 : 1
    const mapa: Record<string, [number, number]> = {
      ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo],
    }
    const d = mapa[e.key]
    if (!d) return
    e.preventDefault()
    onChange({
      x: Math.min(100, Math.max(0, foco.x + d[0])),
      y: Math.min(100, Math.max(0, foco.y + d[1])),
    })
  }

  return (
    <div>
      <div
        ref={caixaRef}
        className="relative w-full cursor-crosshair overflow-hidden rounded-menuzia border border-border bg-page select-none"
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          setArrastando(true)
          pontoDoEvento(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => { if (arrastando) pontoDoEvento(e.clientX, e.clientY) }}
        onPointerUp={() => setArrastando(false)}
        onPointerCancel={() => setArrastando(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="block w-full"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalHeight > 0) setRatioFoto(img.naturalWidth / img.naturalHeight)
          }}
        />

        {/* Escurece o que fica fora do recorte mais estreito, pra dar a noção do corte. */}
        {proporcoes.map((p) => (
          <div key={p.rotulo} className="pointer-events-none absolute inset-0">
            <div
              className="absolute border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
              style={molduraStyle(p.ratio, ratioFoto, foco)}
            />
            <span className="absolute left-1 top-1 rounded-menuzia bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {p.rotulo}
            </span>
          </div>
        ))}

        {/* A mira. Redonda de propósito: é um alvo, não um card (CLAUDE.md §3). */}
        <button
          type="button"
          aria-label="Ponto de foco da imagem"
          onKeyDown={teclado}
          className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-primary/70 shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
          style={{ left: `${foco.x}%`, top: `${foco.y}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-text-subtle">
        Arraste a mira até o que não pode ser cortado. Use as setas do teclado para ajuste fino
        (Shift para passos maiores). Posição atual: {objectPosition(foco)}.
      </p>
    </div>
  )
}

/**
 * Moldura do recorte: a maior área da proporção pedida que cabe na foto,
 * centrada no foco e presa dentro das bordas — a mira nunca sai do quadro.
 *
 * Precisa da proporção REAL da foto pra acertar: uma capa 3:1 recortada em 2:1
 * perde das laterais, e a mesma capa recortada em 3,8:1 perde de cima e de
 * baixo. Sem medir a imagem, a moldura apontaria o corte errado justamente no
 * caso que o lojista está tentando resolver.
 */
function molduraStyle(ratioAlvo: number, ratioFoto: number, foco: Foco): React.CSSProperties {
  // Em fração da caixa (que tem a proporção da foto). Se o alvo é mais largo
  // que a foto, a largura satura em 100% e sobra altura; se é mais estreito,
  // o contrário.
  const larguraPct = ratioAlvo >= ratioFoto ? 100 : (ratioAlvo / ratioFoto) * 100
  const alturaPct = ratioAlvo >= ratioFoto ? (ratioFoto / ratioAlvo) * 100 : 100
  const left = Math.min(100 - larguraPct, Math.max(0, foco.x - larguraPct / 2))
  const top = Math.min(100 - alturaPct, Math.max(0, foco.y - alturaPct / 2))
  return { width: `${larguraPct}%`, height: `${alturaPct}%`, left: `${left}%`, top: `${top}%` }
}
```

- [ ] **Step 2: Conferir tipagem e lint**

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

Run: `npx next lint --file components/seletor-foco.tsx`
Expected: sem erro

- [ ] **Step 3: Commit**

```bash
git add components/seletor-foco.tsx
git commit -m "feat(admin): componente de mira pro ponto de foco de imagem"
```

---

### Task 4: Banner 2:1 com ponto de foco na vitrine

**Files:**
- Modify: `app/loja/[slug]/vitrine.tsx` (bloco da capa, linhas 2305-2332)

**Interfaces:**
- Consumes: `objectPosition` de `lib/foco-imagem.ts` (Task 1); `RestauranteVitrine.bannerFoco` (Task 2).
- Produces: nada para outras tasks.

- [ ] **Step 1: Importar o helper**

No topo de `vitrine.tsx`, junto aos outros imports:

```ts
import { objectPosition } from '@/lib/foco-imagem'
```

- [ ] **Step 2: Trocar a altura da capa**

Localize (linha ~2311):

```tsx
                <div className="relative z-0 h-28 w-full overflow-hidden sm:h-40 lg:h-80 lg:rounded-menuzia">
```

Troque por:

```tsx
                {/* 2:1 no celular: a capa é o primeiro contato do cliente com a
                    loja, e a tarja de 112px que havia aqui (3,5:1) não cumpria
                    esse papel. O desktop segue na altura fixa de sempre. */}
                <div className="relative z-0 aspect-[2/1] w-full overflow-hidden lg:aspect-auto lg:h-80 lg:rounded-menuzia">
```

- [ ] **Step 3: Ancorar o recorte no foco**

No `<img>` da capa (linha ~2324), troque:

```tsx
                      className="h-full w-full object-cover"
```

por:

```tsx
                      className="h-full w-full object-cover"
                      style={{ objectPosition: objectPosition(restaurante.bannerFoco) }}
```

O `ProductImage` do fallback (quando a loja não tem capa e usa a foto de um produto) fica como está: sem capa própria não há foco que o lojista tenha escolhido.

- [ ] **Step 4: Conferir tipagem e lint**

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

Run: `npx next lint --file "app/loja/[slug]/vitrine.tsx"`
Expected: sem erro

Run: `npm test`
Expected: 386 passed / 10 skipped

- [ ] **Step 5: Commit**

```bash
git add "app/loja/[slug]/vitrine.tsx"
git commit -m "feat(vitrine): capa em 2:1 no celular ancorada no ponto de foco"
```

---

### Task 5: Mira da capa no painel, e a opção "Gaveta" travada

**Files:**
- Modify: `app/admin/ajustes/page.tsx` (form linha 278; `set` linha 326; `setLayout` linha 394; salvamento linha 467; seletor de layout linhas 746-772)

**Interfaces:**
- Consumes: `SeletorFoco` (Task 3); `Foco`, `FOCO_PADRAO` (Task 1); `ConfigLoja.bannerFoco` e o patch `bannerFoco` (Task 2); `listarGrupos` de `lib/queries/cardapio` (Task 2, que agora traz `imagemUrl`).
- Produces: nada para outras tasks.

- [ ] **Step 1: Estado do foco no formulário**

Imports no topo:

```ts
import { SeletorFoco } from '@/components/seletor-foco'
import { FOCO_PADRAO, type Foco } from '@/lib/foco-imagem'
import { listarGrupos } from '@/lib/queries/cardapio'
```

No estado inicial do `form` (linha ~278), acrescente:

```ts
    bannerFoco: FOCO_PADRAO as Foco,
```

No carregamento da config (linha ~315), acrescente:

```ts
        bannerFoco: c.bannerFoco,
```

No payload de salvamento (linha ~467), acrescente:

```ts
        bannerFoco: form.bannerFoco,
```

- [ ] **Step 2: Renderizar a mira embaixo do upload da capa**

Logo depois do bloco que mostra a capa enviada (procure por `bannerInputRef` e pelo preview do `form.bannerUrl`), acrescente:

```tsx
{form.bannerUrl && (
  <Field label="Recorte da capa" hint="A capa aparece em proporções diferentes no celular e no computador. Marque o que não pode ser cortado.">
    <SeletorFoco
      src={form.bannerUrl}
      foco={form.bannerFoco}
      onChange={(f) => { setForm((prev) => ({ ...prev, bannerFoco: f })); setSaved(false) }}
      proporcoes={[{ rotulo: 'Celular', ratio: 2 }, { rotulo: 'Computador', ratio: 3.8 }]}
    />
  </Field>
)}
```

O `setSaved(false)` é o que acende o botão "Salvar alterações" — nesta tela nada salva sozinho, e o foco não vira exceção.

- [ ] **Step 3: Carregar as categorias pra saber quais estão sem foto**

Acrescente ao componente, junto aos outros `useState`:

```ts
  const [categoriasSemFoto, setCategoriasSemFoto] = useState<string[]>([])
```

E no mesmo `useEffect` que já carrega a config (onde `restauranteId` está disponível):

```ts
      listarGrupos(supabase, restauranteId)
        .then((gs) => setCategoriasSemFoto(gs.filter((g) => !g.imagemUrl).map((g) => g.nome)))
        .catch(() => setCategoriasSemFoto([]))
```

Falha ao listar cai em lista vazia de propósito: se não deu pra conferir, não trava o lojista — a pior consequência é ele ligar o modo e ver um cartão sem foto, que a vitrine trata (spec §5.5).

- [ ] **Step 4: Terceira opção no seletor de layout**

Troque o `div` de duas colunas (linha ~748) por três, e acrescente o botão da gaveta depois do de Lista:

```tsx
            <div className="grid grid-cols-3 gap-2.5">
```

```tsx
              <button
                type="button"
                disabled={categoriasSemFoto.length > 0}
                onClick={() => setLayout('gaveta')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  form.layoutCardapio === 'gaveta' ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Gaveta</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Cartão por categoria, com foto</div>
              </button>
```

E, logo abaixo do grid, o aviso do que falta:

```tsx
            {categoriasSemFoto.length > 0 && (
              <p className="mt-2 rounded-menuzia bg-alert-bg px-3 py-2 text-[12px] leading-relaxed text-alert-text">
                O modo Gaveta precisa de uma foto em cada categoria. Faltam{' '}
                {categoriasSemFoto.length}: {categoriasSemFoto.join(' · ')}.{' '}
                <a href="/admin/cardapio" className="font-semibold underline">Subir fotos no cardápio</a>.
              </p>
            )}
```

- [ ] **Step 4b: Ajustar a assinatura de `setLayout`**

`setLayout` (linha ~394) já recebe `LayoutCardapio`, que agora inclui `'gaveta'` — não precisa mudar. Confirme lendo a função.

- [ ] **Step 5: Conferir**

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

Run: `npx next lint --file app/admin/ajustes/page.tsx`
Expected: sem erro

Run: `npm test`
Expected: 386 passed / 10 skipped

- [ ] **Step 6: Commit**

```bash
git add app/admin/ajustes/page.tsx
git commit -m "feat(admin): mira da capa e opcao Gaveta travada sem foto de categoria"
```

---

### Task 6: Foto e mira da categoria no gestor de cardápio

**Files:**
- Modify: `app/admin/cardapio/page.tsx` (`startEditCategoria` linha 2209 e o formulário de categoria que ele abre)

**Interfaces:**
- Consumes: `SeletorFoco` (Task 3); `enviarImagemCategoria` (Task 2); `atualizarGrupo` com os parâmetros novos (Task 2); `GrupoCardapio.imagemUrl` / `.imagemFoco` (Task 2).
- Produces: nada para outras tasks.

- [ ] **Step 1: Imports e estado**

No topo:

```ts
import { SeletorFoco } from '@/components/seletor-foco'
import { FOCO_PADRAO, type Foco } from '@/lib/foco-imagem'
import { enviarImagemCategoria } from '@/lib/queries/ajustes'
```

Junto ao estado que `startEditCategoria` já usa (procure pelos `useState` do nome e do horário da categoria em edição):

```ts
  const [catImagemUrl, setCatImagemUrl] = useState<string | null>(null)
  const [catFoco, setCatFoco] = useState<Foco>(FOCO_PADRAO)
  const [catEnviando, setCatEnviando] = useState(false)
```

- [ ] **Step 2: Preencher ao abrir a edição**

Dentro de `startEditCategoria(group)` (linha 2209), acrescente:

```ts
    setCatImagemUrl(group.imagemUrl)
    setCatFoco(group.imagemFoco)
```

E no lugar onde o formulário é aberto para uma categoria **nova**, acrescente:

```ts
    setCatImagemUrl(null)
    setCatFoco(FOCO_PADRAO)
```

- [ ] **Step 3: Upload + mira no formulário**

No formulário de categoria, abaixo do campo de nome:

```tsx
<div className="mt-3">
  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
    Foto da categoria
  </label>
  <p className="mb-2 text-[11px] leading-relaxed text-text-subtle">
    Usada no modo de exibição &ldquo;Gaveta&rdquo;, onde o cliente escolhe a categoria antes dos produtos.
  </p>
  <input
    type="file"
    accept="image/*"
    disabled={catEnviando}
    onChange={async (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      setCatEnviando(true)
      try {
        setCatImagemUrl(await enviarImagemCategoria(supabase, restauranteId, file))
      } catch {
        alert('Não foi possível enviar a imagem. Tente novamente.')
      } finally {
        setCatEnviando(false)
      }
    }}
    className="block w-full text-[12px] text-text-subtle file:mr-3 file:rounded-menuzia file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:uppercase file:tracking-wide file:text-white"
  />
  {catEnviando && <p className="mt-1.5 text-[11px] text-text-subtle">Enviando…</p>}
  {catImagemUrl && (
    <div className="mt-3">
      <SeletorFoco
        src={catImagemUrl}
        foco={catFoco}
        onChange={setCatFoco}
        proporcoes={[{ rotulo: 'Cartão', ratio: 2.2 }]}
      />
      <button
        type="button"
        onClick={() => { setCatImagemUrl(null); setCatFoco(FOCO_PADRAO) }}
        className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-danger"
      >
        Remover foto
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 4: Gravar ao salvar a categoria**

Na função que salva a categoria editada, passe os dois parâmetros novos à chamada de `atualizarGrupo`:

```ts
await atualizarGrupo(supabase, grupo.id, nome.trim(), horario, { url: catImagemUrl, foco: catFoco })
```

E atualize o estado local da lista de grupos para refletir `imagemUrl: catImagemUrl` e `imagemFoco: catFoco`, do mesmo jeito que as outras edições dessa tela já fazem com nome e horário.

- [ ] **Step 5: Conferir**

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

Run: `npx next lint --file app/admin/cardapio/page.tsx`
Expected: sem erro

Run: `npm test`
Expected: 386 passed / 10 skipped

- [ ] **Step 6: Commit**

```bash
git add app/admin/cardapio/page.tsx
git commit -m "feat(admin): foto e ponto de foco por categoria no gestor de cardapio"
```

---

### Task 7: Modo gaveta na vitrine

**Files:**
- Modify: `app/loja/[slug]/vitrine.tsx` (renderização das seções, linhas 2542-2552)

**Interfaces:**
- Consumes: `LayoutCardapio` com `'gaveta'` e `GrupoCardapio.imagemUrl` / `.imagemFoco` (Task 2); `objectPosition` (Task 1).
- Produces: nada para outras tasks.

- [ ] **Step 1: Estado da categoria aberta**

Junto aos outros `useState` da vitrine:

```ts
  // Modo gaveta: qual categoria está aberta em tela cheia. null = a grade de cartões.
  const [categoriaAberta, setCategoriaAberta] = useState<string | null>(null)
```

- [ ] **Step 2: Componente do cartão de categoria**

Ao lado de `ItemsGrid` (linha 440), acrescente:

```tsx
/**
 * Grade de cartões de categoria do modo "gaveta". Categoria sem foto ainda
 * aparece — com o nome sobre a cor do tema — porque esconder o cartão
 * esconderia junto todos os produtos daquela categoria, que o cliente
 * deixaria de conseguir comprar sem aviso nenhum.
 */
function CategoriasGaveta({ grupos, onAbrir }: { grupos: GrupoComItens[]; onAbrir: (id: string) => void }) {
  return (
    <div className="space-y-3 px-4 pb-1 pt-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 lg:px-0">
      {grupos.map((g) => (
        <button
          key={g.id}
          onClick={() => onAbrir(g.id)}
          className="relative block h-36 w-full overflow-hidden rounded-menuzia border border-border text-left shadow-sm transition-shadow hover:shadow-md active:scale-[0.99] sm:h-44"
        >
          {g.imagemUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={g.imagemUrl}
              alt={g.nome}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              style={{ objectPosition: objectPosition(g.imagemFoco) }}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[var(--tema-from)] via-[var(--tema-primaria)] to-[var(--tema-dark)]" />
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10">
            <span className="text-[17px] font-bold uppercase tracking-wide text-white">{g.nome}</span>
            <span className="ml-2 text-[12px] font-medium text-white/80">{g.itens.length} itens</span>
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Ramificar a renderização da Home**

Localize o bloco `{/* Regular categories (or search results) */}` (linha ~2542). Envolva-o para que o modo gaveta assuma quando não houver busca ativa:

```tsx
            {/* Modo gaveta: a grade de categorias substitui a lista de seções.
                A busca continua varrendo tudo — é a saída de quem não quer navegar. */}
            {!loading && activeCategory !== '__promos__' && restaurante.layoutCardapio === 'gaveta' && !search.trim() && (
              categoriaAberta === null ? (
                <CategoriasGaveta grupos={groups} onAbrir={setCategoriaAberta} />
              ) : (
                (() => {
                  const cat = groups.find((g) => g.id === categoriaAberta)
                  if (!cat) { setCategoriaAberta(null); return null }
                  return (
                    <div className="px-4 pb-1 pt-4 lg:px-0">
                      <button
                        onClick={() => setCategoriaAberta(null)}
                        className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-text-subtle"
                      >
                        <span aria-hidden>‹</span> Todas as categorias
                      </button>
                      <h2 className="mb-3 text-[17px] font-bold tracking-tight">{cat.nome}</h2>
                      <ItemsGrid items={cat.itens} layout="categoria" onSelect={openProduct} imagemGrande={restaurante.imagemGrande} />
                    </div>
                  )
                })()
              )
            )}
```

E acrescente `&& (restaurante.layoutCardapio !== 'gaveta' || !!search.trim())` à condição do bloco de seções que já existe, para que os dois não rendam ao mesmo tempo:

```tsx
            {!loading && activeCategory !== '__promos__' && (restaurante.layoutCardapio !== 'gaveta' || !!search.trim()) &&
              (search.trim()
```

> `ItemsGrid` recebe `layout="categoria"` fixo dentro da gaveta: dentro de uma categoria aberta, a grade de cartões é a apresentação certa. `'gaveta'` não é um layout de grade de itens.

- [ ] **Step 4: Fechar a categoria ao trocar de aba**

Onde a vitrine muda `tab` (busque por `setTab(`), acrescente `setCategoriaAberta(null)` junto — voltar da sacola pra Home deve mostrar as categorias, não a última aberta.

- [ ] **Step 5: Conferir**

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

Run: `npx next lint --file "app/loja/[slug]/vitrine.tsx"`
Expected: sem erro

Run: `npm test`
Expected: 386 passed / 10 skipped

- [ ] **Step 6: Commit**

```bash
git add "app/loja/[slug]/vitrine.tsx"
git commit -m "feat(vitrine): modo gaveta com cartao por categoria"
```

---

### Task 8: Fonte Rubik na vitrine

**Files:**
- Create: `app/loja/[slug]/layout.tsx`
- Modify: `tailwind.config.ts` (bloco `fontFamily`, perto da linha 79)
- Modify: `app/loja/[slug]/vitrine.tsx` (contêiner raiz, linha ~2300)
- Modify: `CLAUDE.md` (§3)

**Interfaces:**
- Consumes: nada.
- Produces: classe `font-vitrine`.

- [ ] **Step 1: Carregar a Rubik só na rota da vitrine**

Crie `app/loja/[slug]/layout.tsx`:

```tsx
import { Rubik } from 'next/font/google'

/**
 * A vitrine usa Rubik; o painel segue em Inter (app/layout.tsx).
 *
 * Carregar aqui, e não na raiz, é o que impede o painel de baixar uma fonte
 * que ele não usa — e a vitrine de baixar a Inter. `next/font` self-hospeda o
 * arquivo, então não há request a terceiro no caminho crítico.
 */
const rubik = Rubik({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-rubik',
  display: 'swap',
})

export default function LayoutVitrine({ children }: { children: React.ReactNode }) {
  return <div className={rubik.variable}>{children}</div>
}
```

- [ ] **Step 2: Registrar a família no Tailwind**

Em `tailwind.config.ts`, no bloco `fontFamily` (perto da linha 79), acrescente ao lado de `sans`:

```ts
        // A vitrine do cliente usa Rubik (app/loja/[slug]/layout.tsx); o painel
        // segue em `sans` (Inter). Exceção registrada no CLAUDE.md §3.
        vitrine: ["var(--font-rubik)", "Rubik", "sans-serif"],
```

- [ ] **Step 3: Aplicar na vitrine**

Em `vitrine.tsx`, no contêiner raiz (linha ~2300), acrescente `font-vitrine`:

```tsx
      <div className="relative mx-auto min-h-dvh max-w-[600px] bg-[#F3F4F6] pb-24 font-vitrine lg:max-w-[1280px] lg:pb-16">
```

- [ ] **Step 4: Atualizar o CLAUDE.md**

Em `CLAUDE.md` §3, na linha que começa com `- Fonte: **Inter**`, troque por:

```markdown
- Fonte: **Inter** (Google Fonts, pesos 400/500/600/700/800), `font-size` base 14px,
  em todo o painel administrativo. **Exceção: a vitrine do cliente
  (`app/loja/[slug]/`) usa Rubik**, carregada em `app/loja/[slug]/layout.tsx` e
  exposta como a família `font-vitrine` do Tailwind — decisão de 2026-09-13,
  ver `docs/superpowers/specs/2026-09-13-vitrine-banner-gaveta-design.md`.
```

- [ ] **Step 5: Conferir**

Run: `npx tsc --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(.*//' | sort -u | grep -v -E '\.test\.tsx?$|tailwind\.config'`
Expected: saída vazia

Run: `npm test`
Expected: 386 passed / 10 skipped. Se `tailwind.config.test.ts` verificar as famílias declaradas, ajuste-o para aceitar a nova.

- [ ] **Step 6: Commit**

```bash
git add "app/loja/[slug]/layout.tsx" tailwind.config.ts "app/loja/[slug]/vitrine.tsx" CLAUDE.md
git commit -m "feat(vitrine): fonte Rubik na vitrine, painel segue em Inter"
```

---

### Task 9: Semear as fotos de categoria da Pizza do Rosa

**Files:**
- Create: `scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs`

**Interfaces:**
- Consumes: `dados/cardapio-origem.json` (já commitado); as colunas da Task 1.
- Produces: nada para outras tasks.

- [ ] **Step 1: Escrever o script**

Crie `scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs`, no mesmo molde do `repor-fotos.mjs` que já existe nessa pasta — **leia aquele arquivo primeiro e siga o mesmo formato** de dry-run, log e tratamento de falha:

```js
/**
 * Semeia a foto de cada categoria da Pizza do Rosa a partir da origem.
 *
 * A plataforma antiga serve uma imagem de fundo por sessão
 * (`sessao_catbackgroundmobile`). As 15 categorias do Menuzia derivam das 12
 * sessões da origem, então todas ficam cobertas e o lojista pode ligar o modo
 * gaveta sem subir foto à mão.
 *
 * Só grava em categoria cujo `imagem_url` é NULL. Não cria nem apaga linha.
 * Rodar de novo é no-op.
 *
 *   node scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs           # dry-run
 *   node scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs --apply
 */
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SLUG = 'pizza-do-rosa'
const MARCA = 'import-expresso-2026-09' // mesma pasta do import, pra reversão continuar pegando tudo
const APPLY = process.argv.includes('--apply')
const BASE_ORIGEM = 'https://static.expressodelivery.com.br/imagens'

/** Categoria do Menuzia → sessão da origem de onde sai a foto. */
const DE_ONDE = {
  'Pizzas Salgadas': 'PIZZA',
  'Pizzas Doces': 'PIZZA',
  'Pizza Promocional': 'Pizza Promocional',
  'Pizza Brotinho': 'Pizza Brotinho',
  'Hambúrguers': 'Hambúrguers',
  'Pizza Burguer': 'Hambúrguers',
  'Porções': 'Porções',
  'Massas': 'Massas',
  'Saladas': 'Saladas',
  'Sobremesas': 'Sobremesas',
  'Bebidas': 'Bebidas',
  'Cervejas e Vinhos': 'Bebidas',
  'Molhos': 'Molhos',
  'Congelados': 'Congelados',
  'Loja Virtual': 'Loja Virtual',
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const origem = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-origem.json'), 'utf8'))

const log = (...a) => console.log(APPLY ? '[apply]' : '[dry-run]', ...a)
const slugificar = (n) => n.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()

async function baixarESubir(url, caminho) {
  let r
  try { r = await fetch(url, { signal: AbortSignal.timeout(30_000) }) }
  catch (e) { console.warn('  ! download falhou', url, String(e.message ?? e)); return null }
  if (!r.ok) { console.warn('  ! download HTTP', r.status, url); return null }
  let buf
  try { buf = Buffer.from(await r.arrayBuffer()) }
  catch (e) { console.warn('  ! leitura falhou', url, String(e.message ?? e)); return null }
  const { error } = await db.storage.from('cardapio').upload(caminho, buf, {
    contentType: r.headers.get('content-type') ?? 'image/jpeg', upsert: true,
  })
  if (error) { console.warn('  ! upload falhou', caminho, error.message); return null }
  return db.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
}

async function main() {
  const { data: loja, error: eLoja } = await db.from('restaurantes').select('id, nome').eq('slug', SLUG).single()
  if (eLoja) throw eLoja
  log('loja', loja.nome, loja.id)

  const fundoDaSessao = new Map(
    origem.sessoes.filter((s) => s.catBackground ?? s.sessao_catbackgroundmobile)
      .map((s) => [s.nome ?? s.sessao_nome, s.catBackground ?? s.sessao_catbackgroundmobile]),
  )

  const { data: grupos, error: eG } = await db
    .from('grupos_cardapio').select('id, nome, imagem_url').eq('restaurante_id', loja.id).order('posicao')
  if (eG) throw eG

  const pendentes = grupos.filter((g) => !g.imagem_url)
  if (pendentes.length === 0) { log('nada pendente — todas as categorias já têm foto'); return }
  log(`${pendentes.length} categoria(s) sem foto`)

  let ok = 0
  const falhas = []
  for (const g of pendentes) {
    const sessao = DE_ONDE[g.nome]
    const caminhoOrigem = sessao ? fundoDaSessao.get(sessao) : null
    if (!caminhoOrigem) { falhas.push({ nome: g.nome, motivo: 'sem imagem correspondente na origem' }); continue }
    const url = `${BASE_ORIGEM}${caminhoOrigem}`
    const ext = (url.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase()
    const destino = `${loja.id}/${MARCA}/categoria-${slugificar(g.nome)}-${Date.now()}.${['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg'}`
    if (!APPLY) { log('  (dry-run)', g.nome, '←', url); continue }
    const publica = await baixarESubir(url, destino)
    if (!publica) { falhas.push({ nome: g.nome, motivo: url }); continue }
    const { error } = await db.from('grupos_cardapio').update({ imagem_url: publica }).eq('id', g.id)
    if (error) { falhas.push({ nome: g.nome, motivo: error.message }); continue }
    ok++
    log('  ✔', g.nome)
  }

  log(`FIM — ${ok} semeada(s), ${falhas.length} falhando`)
  for (const f of falhas) log(`  ! ${f.nome} — ${f.motivo}`)
}

main().catch((e) => { console.error('ERRO:', e.message); if (e.details) console.error(' details:', e.details); console.error(e.stack); process.exit(1) })
```

> **Confira o nome real dos campos** em `dados/cardapio-origem.json` antes de rodar: o `extrair.mjs` pode ter renomeado `sessao_catbackgroundmobile`. O código acima aceita os dois nomes; se nenhum existir, o extrator não guardou esse campo — nesse caso **pare e reporte**, não invente outra fonte de imagem.

- [ ] **Step 2: Rodar o dry-run**

Run: `node scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs`
Expected: lista 15 categorias pendentes, cada uma com a URL de origem, e termina sem erro. Se alguma sair com "sem imagem correspondente na origem", reporte quais — não ajuste o mapa `DE_ONDE` para inventar uma correspondência.

**Não rode com `--apply`.** O controller executa isso.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-pizza-do-rosa/semear-fotos-categoria.mjs
git commit -m "chore(import): semeia as fotos de categoria da Pizza do Rosa"
```

---

## Sequenciamento

Tasks 1 → 2 são fundação e bloqueiam todo o resto. Depois disso: 3 (mira) bloqueia 5 e 6; 4 (banner na vitrine) e 8 (Rubik) são independentes e podem ir a qualquer momento; 7 (gaveta na vitrine) depende só da 2; 9 depende da 1 e só roda depois da migration aplicada.

## Pontos conhecidos e não resolvidos

- Entre a montagem do `SeletorFoco` e o `onLoad` da foto, a moldura usa uma proporção chutada (2:1) e pode piscar na posição errada por um frame. Aceitável: a correção acontece no primeiro render após o carregamento, e a mira em si nunca depende disso.
- Categoria criada depois do modo ligado aparece como cartão sem foto na cor do tema (spec §5.5). É deliberado: entre um cartão feio e um produto invisível, o cartão feio é o certo.
- O modo gaveta não altera a aba Promoções nem a busca — as duas continuam listando itens de todas as categorias.
