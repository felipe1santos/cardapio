# Pizza meio a meio + import do cardápio da Pizza do Rosa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Menuzia vender pizza com mais de um sabor (meio a meio, 3 e 4 sabores) e, em cima disso, importar os 227 itens do cardápio da Pizza do Rosa vindos do Expresso Delivery.

**Architecture:** O nome do sabor já é um `text` snapshot em `pedido_itens.sabor_nome` e todos os consumidores (kanban, cozinha, WhatsApp, recibo térmico, PDV) só imprimem esse texto. Então "meio a meio" é uma junção de nomes com o separador `" / "` — nenhuma tabela nova, nenhuma mudança em impressão. O que muda de verdade é: um limite de sabores por tamanho (`tamanhos_padrao_pizza.max_sabores`), uma regra de cálculo por loja (`restaurantes.pizza_calculo_preco`), a seleção múltipla na vitrine e no PDV, e a revalidação server-side em `criarPedido`. O import é um script Node idempotente que roda local contra produção com service role.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres + Storage), Tailwind, Vitest, `pg`/`@supabase/supabase-js` nos scripts.

**Spec:** `docs/superpowers/specs/2026-09-12-pizza-do-rosa-migracao.md`

## Global Constraints

- Paleta, fonte Inter e `--radius-max: 3px` conforme CLAUDE.md §3. Nenhuma cor nova.
- **Proibido alterar a folha de impressão térmica** (`printer-agent/src/recibo.js`) — CLAUDE.md §7. Nenhuma task abaixo toca esse arquivo.
- Migrations aditivas e idempotentes (`add column if not exists`). **Nunca converter formato de dado existente** — memória `feedback_migration_formato_dado`.
- **Default seguro em feature de gating:** `max_sabores` nasce `1`, que é exatamente o comportamento de hoje. Loja existente não muda de comportamento sozinha — memória `feedback_default_seguro_features_gating`.
- Separador de sabores é a constante `SEPARADOR_SABORES = ' / '`. Nenhum sabor do cardápio da Pizza do Rosa contém `" / "` (verificado nos 227 itens), e a Task 3 impede cadastrar um que contenha.
- Rodar teste com `npm test` (vitest). Testes puros ficam ao lado do módulo: `lib/x.ts` → `lib/x.test.ts`.
- Branch: `main` (Coolify lê `main`; memória `project_menuzia_deploy`). Commit + push depois de cada task validada (memória `feedback_always_commit_push`).
- Não rodar `npm run build` com o dev server de pé (memória `project_ambiente_testes`).

---

## File Structure

**Parte A — meio a meio**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0050_pizza_meio_a_meio.sql` (criar) | `max_sabores` no tamanho, `pizza_calculo_preco` na loja |
| `lib/pizza-preco.ts` (criar) | funções puras: junta/separa nomes de sabor, calcula preço por regra |
| `lib/pizza-preco.test.ts` (criar) | testes das funções puras |
| `lib/queries/pizza.ts` (modificar) | `maxSabores` no tipo e no CRUD de tamanho |
| `lib/queries/cardapio.ts` (modificar) | `pizzaCalculoPreco` em `RestauranteVitrine`; guarda de `" / "` em `criarSabor` |
| `lib/queries/pedidos.ts` (modificar) | validação/cálculo multi-sabor em `criarPedido` |
| `lib/queries/pedidos.pizza.test.ts` (criar) | testes da validação server-side |
| `app/loja/[slug]/vitrine.tsx` (modificar) | seleção múltipla + esconder tamanho sem preço |
| `app/admin/pdv/page.tsx` (modificar) | seleção múltipla no balcão |
| `app/admin/cardapio/page.tsx` (modificar) | campo "máx. sabores" e seletor da regra de preço |

**Parte B — import**

| Arquivo | Responsabilidade |
|---|---|
| `scripts/import-pizza-do-rosa/extrair.mjs` (criar) | baixa origem → `dados/cardapio-origem.json` |
| `scripts/import-pizza-do-rosa/mapear.mjs` (criar) | origem → formato Menuzia (`dados/cardapio-menuzia.json`) |
| `scripts/import-pizza-do-rosa/mapear.test.mjs` (criar) | testes do mapeamento |
| `scripts/import-pizza-do-rosa/importar.mjs` (criar) | grava no Supabase (dry-run por padrão) |
| `scripts/import-pizza-do-rosa/README.md` (criar) | como rodar, como reverter |

---

## Parte A — Pizza meio a meio

### Task 1: Migration — limite de sabores por tamanho e regra de preço da loja

**Files:**
- Create: `supabase/migrations/0050_pizza_meio_a_meio.sql`
- Create: `supabase/migrations/0050_pizza_meio_a_meio.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `tamanhos_padrao_pizza.max_sabores int not null default 1`; coluna `restaurantes.pizza_calculo_preco text not null default 'media'` restrita a `'media' | 'maior'`.

- [ ] **Step 1: Escrever o teste que falha**

Os testes de migration deste repo leem o SQL e conferem o conteúdo. Siga o padrão de `supabase/migrations/0002_menu_cardapio.test.ts`. Crie `supabase/migrations/0050_pizza_meio_a_meio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const sql = readFileSync(join(__dirname, '0050_pizza_meio_a_meio.sql'), 'utf8')

describe('0050 pizza meio a meio', () => {
  it('adiciona max_sabores no tamanho padrão de pizza', () => {
    expect(sql).toMatch(/alter table tamanhos_padrao_pizza[\s\S]*add column if not exists max_sabores int not null default 1/)
  })

  it('nasce com 1 sabor pra não mudar o comportamento de loja existente', () => {
    expect(sql).toContain('default 1')
    expect(sql).not.toMatch(/update\s+tamanhos_padrao_pizza/i)
  })

  it('adiciona a regra de preço na loja, restrita a media|maior', () => {
    expect(sql).toMatch(/alter table restaurantes[\s\S]*add column if not exists pizza_calculo_preco text not null default 'media'/)
    expect(sql).toMatch(/check \(pizza_calculo_preco in \('media', 'maior'\)\)/)
  })

  it('é idempotente', () => {
    const adds = sql.match(/add column/g) ?? []
    const guards = sql.match(/add column if not exists/g) ?? []
    expect(guards.length).toBe(adds.length)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- supabase/migrations/0050_pizza_meio_a_meio.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... 0050_pizza_meio_a_meio.sql`

- [ ] **Step 3: Escrever a migration**

Crie `supabase/migrations/0050_pizza_meio_a_meio.sql`:

```sql
-- ============================================================================
-- Pizza meio a meio: quantos sabores cabem em cada tamanho e como a loja
-- calcula o preço quando o cliente escolhe mais de um.
--
-- Aditiva e idempotente. `max_sabores` nasce 1 — exatamente o que o Menuzia
-- faz hoje (um sabor por pizza) — então nenhuma loja já cadastrada muda de
-- comportamento ao aplicar esta migration. Quem quiser meio a meio sobe o
-- número no admin, tamanho a tamanho.
-- ============================================================================

alter table tamanhos_padrao_pizza
  add column if not exists max_sabores int not null default 1;

comment on column tamanhos_padrao_pizza.max_sabores is
  'Quantos sabores o cliente pode escolher nesse tamanho. 1 = sem meio a meio.';

-- Regra de preço quando há mais de um sabor:
--   media = média aritmética dos sabores escolhidos (padrão de mercado)
--   maior = o preço do sabor mais caro
alter table restaurantes
  add column if not exists pizza_calculo_preco text not null default 'media';

alter table restaurantes
  drop constraint if exists restaurantes_pizza_calculo_preco_check;

alter table restaurantes
  add constraint restaurantes_pizza_calculo_preco_check
  check (pizza_calculo_preco in ('media', 'maior'));
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- supabase/migrations/0050_pizza_meio_a_meio.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Aplicar a migration no Supabase remoto**

Run: `node scripts/setup-db.mjs`
Expected: log indicando `0050_pizza_meio_a_meio.sql` aplicada. Se o script pedir confirmação, confirmar.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0050_pizza_meio_a_meio.sql supabase/migrations/0050_pizza_meio_a_meio.test.ts
git commit -m "feat(pizza): max_sabores por tamanho e regra de preco da loja"
```

---

### Task 2: Módulo puro de preço e nome de pizza multi-sabor

**Files:**
- Create: `lib/pizza-preco.ts`
- Create: `lib/pizza-preco.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type RegraPrecoPizza = 'media' | 'maior'`
  - `const SEPARADOR_SABORES: ' / '`
  - `function juntarSabores(nomes: string[]): string`
  - `function separarSabores(texto: string): string[]`
  - `function precoPizzaSabores(precos: number[], regra: RegraPrecoPizza): number`
  - `function nomeTemSeparador(nome: string): boolean`

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/pizza-preco.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  SEPARADOR_SABORES,
  juntarSabores,
  separarSabores,
  precoPizzaSabores,
  nomeTemSeparador,
} from './pizza-preco'

describe('juntarSabores / separarSabores', () => {
  it('junta e separa preservando a ordem', () => {
    const nomes = ['Calabresa', 'Frango C/ Catupiry']
    expect(juntarSabores(nomes)).toBe('Calabresa / Frango C/ Catupiry')
    expect(separarSabores(juntarSabores(nomes))).toEqual(nomes)
  })

  it('um sabor só vira o próprio nome, sem separador', () => {
    expect(juntarSabores(['Portuguesa'])).toBe('Portuguesa')
    expect(separarSabores('Portuguesa')).toEqual(['Portuguesa'])
  })

  it('texto vazio vira lista vazia', () => {
    expect(separarSabores('')).toEqual([])
    expect(separarSabores('   ')).toEqual([])
  })

  it('não confunde "C/" no meio do nome com o separador', () => {
    expect(separarSabores('Bacon C/ Milho')).toEqual(['Bacon C/ Milho'])
    expect(separarSabores('Bacon C/ Milho / Calabresa')).toEqual(['Bacon C/ Milho', 'Calabresa'])
  })

  it('nomeTemSeparador acusa nome que quebraria o round-trip', () => {
    expect(nomeTemSeparador('Calabresa / Frango')).toBe(true)
    expect(nomeTemSeparador('Bacon C/ Milho')).toBe(false)
    expect(SEPARADOR_SABORES).toBe(' / ')
  })
})

describe('precoPizzaSabores', () => {
  it('um sabor devolve o preço dele, nas duas regras', () => {
    expect(precoPizzaSabores([89], 'media')).toBe(89)
    expect(precoPizzaSabores([89], 'maior')).toBe(89)
  })

  it('media tira a média aritmética', () => {
    expect(precoPizzaSabores([89, 99], 'media')).toBe(94)
    expect(precoPizzaSabores([89, 99, 109], 'media')).toBe(99)
  })

  it('maior pega o sabor mais caro', () => {
    expect(precoPizzaSabores([89, 99], 'maior')).toBe(99)
    expect(precoPizzaSabores([109, 89, 99], 'maior')).toBe(109)
  })

  it('arredonda a média pra 2 casas, sem sobra de centavo', () => {
    expect(precoPizzaSabores([89, 99, 100], 'media')).toBe(96)
    expect(precoPizzaSabores([69, 70], 'media')).toBe(69.5)
    expect(precoPizzaSabores([10, 10, 10.01], 'media')).toBe(10)
  })

  it('lista vazia é zero', () => {
    expect(precoPizzaSabores([], 'media')).toBe(0)
    expect(precoPizzaSabores([], 'maior')).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- lib/pizza-preco.test.ts`
Expected: FAIL — `Failed to resolve import "./pizza-preco"`

- [ ] **Step 3: Escrever a implementação mínima**

Crie `lib/pizza-preco.ts`:

```ts
/**
 * Pizza com mais de um sabor.
 *
 * O pedido guarda só o NOME do sabor (`pedido_itens.sabor_nome`, um text), e
 * kanban, cozinha, WhatsApp e recibo térmico apenas imprimem esse texto. Então
 * meio a meio é uma junção de nomes — nenhuma tabela nova, nenhuma mudança na
 * folha de impressão.
 *
 * O separador é " / " com espaços dos dois lados de propósito: nome de sabor
 * costuma ter "C/" colado ("Bacon C/ Milho"), e colado não casa com o separador.
 */

export type RegraPrecoPizza = 'media' | 'maior'

export const SEPARADOR_SABORES = ' / '

export function juntarSabores(nomes: string[]): string {
  return nomes.join(SEPARADOR_SABORES)
}

export function separarSabores(texto: string): string[] {
  return texto
    .split(SEPARADOR_SABORES)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Nome que contém o separador quebraria o round-trip — o cadastro recusa. */
export function nomeTemSeparador(nome: string): boolean {
  return nome.includes(SEPARADOR_SABORES)
}

/**
 * Preço da pizza a partir dos preços dos sabores escolhidos, no tamanho já
 * escolhido. `media` é o padrão de mercado; `maior` é o que algumas casas usam
 * pra não perder margem quando o cliente mistura um sabor caro com um barato.
 */
export function precoPizzaSabores(precos: number[], regra: RegraPrecoPizza): number {
  if (precos.length === 0) return 0
  if (regra === 'maior') return Math.max(...precos)
  const soma = precos.reduce((s, p) => s + p, 0)
  return Math.round((soma / precos.length) * 100) / 100
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- lib/pizza-preco.test.ts`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/pizza-preco.ts lib/pizza-preco.test.ts
git commit -m "feat(pizza): modulo puro de preco e nome multi-sabor"
```

---

### Task 3: Expor `maxSabores` e `pizzaCalculoPreco` nas queries

**Files:**
- Modify: `lib/queries/pizza.ts` (interface `TamanhoPadraoPizza` na linha 4; `listarTamanhosPadraoPizza` linha 34; `criarTamanhoPadraoPizza` linha 44; `atualizarTamanhoPadraoPizza` linha 54)
- Modify: `lib/queries/cardapio.ts` (interface `RestauranteVitrine` linha 770; `buscarRestaurantePorSlug` linha 805; `criarSabor` linha 528)
- Create: `lib/queries/pizza-sabor-guarda.test.ts`

**Interfaces:**
- Consumes: `nomeTemSeparador` de `lib/pizza-preco.ts` (Task 2).
- Produces:
  - `TamanhoPadraoPizza` ganha `maxSabores: number`
  - `criarTamanhoPadraoPizza(supabase, restauranteId, nome, fatias, posicao, maxSabores = 1)`
  - `atualizarTamanhoPadraoPizza(supabase, id, nome, fatias, maxSabores)`
  - `RestauranteVitrine` ganha `pizzaCalculoPreco: RegraPrecoPizza`
  - `criarSabor` lança `Error` se o nome contiver `' / '`

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/queries/pizza-sabor-guarda.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { criarSabor } from './cardapio'

/** Supabase falso: se o guard funcionar, nada disso é chamado. */
function supabaseFake() {
  const single = vi.fn().mockResolvedValue({ data: { id: 'x', nome: 'n', descricao: '', imagem_url: null, status: 'disponivel', posicao: 0 }, error: null })
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select }))
  const from = vi.fn(() => ({ insert }))
  return { client: { from } as never, insert }
}

describe('criarSabor', () => {
  it('recusa nome que contém o separador de sabores', async () => {
    const { client, insert } = supabaseFake()
    await expect(criarSabor(client, 'item-1', 'Calabresa / Frango', 0)).rejects.toThrow(/barra/i)
    expect(insert).not.toHaveBeenCalled()
  })

  it('aceita nome com "C/" colado', async () => {
    const { client, insert } = supabaseFake()
    await criarSabor(client, 'item-1', 'Bacon C/ Milho', 0)
    expect(insert).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- lib/queries/pizza-sabor-guarda.test.ts`
Expected: FAIL — o primeiro teste falha porque `criarSabor` hoje insere sem validar.

- [ ] **Step 3: Implementar as três mudanças**

Em `lib/queries/pizza.ts`, na interface `TamanhoPadraoPizza`:

```ts
export interface TamanhoPadraoPizza {
  id: string
  nome: string
  fatias: number
  posicao: number
  /** Quantos sabores cabem nesse tamanho. 1 = sem meio a meio. */
  maxSabores: number
}
```

E nas três funções do CRUD:

```ts
export async function listarTamanhosPadraoPizza(supabase: ClienteLeitura, restauranteId: string): Promise<TamanhoPadraoPizza[]> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .select('id, nome, fatias, posicao, max_sabores')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((t) => ({
    id: t.id,
    nome: t.nome,
    fatias: t.fatias,
    posicao: t.posicao,
    maxSabores: Math.max(1, Number(t.max_sabores ?? 1)),
  }))
}

export async function criarTamanhoPadraoPizza(
  supabase: SupabaseClient,
  restauranteId: string,
  nome: string,
  fatias: number,
  posicao: number,
  maxSabores = 1,
): Promise<TamanhoPadraoPizza> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .insert({ restaurante_id: restauranteId, nome, fatias, posicao, max_sabores: Math.max(1, maxSabores) })
    .select('id, nome, fatias, posicao, max_sabores')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, fatias: data.fatias, posicao: data.posicao, maxSabores: Math.max(1, Number(data.max_sabores ?? 1)) }
}

export async function atualizarTamanhoPadraoPizza(
  supabase: SupabaseClient,
  id: string,
  nome: string,
  fatias: number,
  maxSabores: number,
) {
  const { error } = await supabase
    .from('tamanhos_padrao_pizza')
    .update({ nome, fatias, max_sabores: Math.max(1, maxSabores) })
    .eq('id', id)
  if (error) throw error
}
```

Em `lib/queries/cardapio.ts`, no topo do arquivo, junto dos outros imports:

```ts
import { nomeTemSeparador, type RegraPrecoPizza } from '@/lib/pizza-preco'
```

Em `criarSabor` (linha 528), antes do insert:

```ts
export async function criarSabor(supabase: SupabaseClient, itemId: string, nome: string, posicao: number): Promise<PizzaSabor> {
  if (nomeTemSeparador(nome)) {
    throw new Error('O nome do sabor não pode ter " / " (barra com espaços) — é o separador usado em pizza meio a meio.')
  }
  // …resto da função como está hoje
```

Faça a mesma guarda em `atualizarSabor` (linha 545), no começo, quando `input.nome` vier definido:

```ts
  if (input.nome !== undefined && nomeTemSeparador(input.nome)) {
    throw new Error('O nome do sabor não pode ter " / " (barra com espaços) — é o separador usado em pizza meio a meio.')
  }
```

Na interface `RestauranteVitrine` (linha 770), acrescente o campo:

```ts
  /** Como a loja calcula o preço de pizza com mais de um sabor. */
  pizzaCalculoPreco: RegraPrecoPizza
```

Em `buscarRestaurantePorSlug` (linha 805), adicione `pizza_calculo_preco` à lista do `.select(...)` e mapeie no retorno:

```ts
    pizzaCalculoPreco: (row.pizza_calculo_preco === 'maior' ? 'maior' : 'media') as RegraPrecoPizza,
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test -- lib/queries/pizza-sabor-guarda.test.ts`
Expected: PASS (2 testes)

Run: `npx tsc --noEmit`
Expected: erros apontando `criarTamanhoPadraoPizza` / `atualizarTamanhoPadraoPizza` em `app/admin/cardapio/page.tsx:1468` e `:1472` — são esperados e serão corrigidos na Task 7. Anote os arquivos e siga.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/pizza.ts lib/queries/cardapio.ts lib/queries/pizza-sabor-guarda.test.ts
git commit -m "feat(pizza): maxSabores e regra de preco nas queries"
```

---

### Task 4: Validar e precificar multi-sabor no servidor (`criarPedido`)

**Files:**
- Modify: `lib/queries/pedidos.ts:934-1006` (bloco `precisaCatalogoPizza` e o ramo `item.tipo_item === 'pizza'`)
- Create: `lib/queries/pedidos-pizza.ts`
- Create: `lib/queries/pedidos-pizza.test.ts`

**Interfaces:**
- Consumes: `precoPizzaSabores`, `separarSabores`, `juntarSabores`, `RegraPrecoPizza` (Task 2).
- Produces:
  - `interface SaborCatalogo { nome: string; status: string; precoPorTamanho: Map<string, number> }`
  - `function resolverPizza(args: ResolverPizzaArgs): { base: number; saborNome: string }` — lança `Error` com mensagem de usuário quando a escolha é inválida.

O cálculo sai de `pedidos.ts` pra um módulo próprio porque `criarPedido` já tem 150 linhas e a regra de pizza é a única parte que merece teste unitário isolado.

- [ ] **Step 1: Escrever o teste que falha**

Crie `lib/queries/pedidos-pizza.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolverPizza, type SaborCatalogo } from './pedidos-pizza'

const TAM_GRANDE = { id: 'tam-g', nome: 'Grande', maxSabores: 3 }
const TAM_PEQUENA = { id: 'tam-p', nome: 'Pequena', maxSabores: 1 }

function sabor(nome: string, preco: number, status = 'disponivel'): SaborCatalogo {
  return { nome, status, precoPorTamanho: new Map([['tam-g', preco], ['tam-p', preco - 20]]) }
}

const catalogo = [sabor('Calabresa', 89), sabor('Portuguesa', 99), sabor('Marguerita', 109), sabor('Atum', 89, 'pausado')]

describe('resolverPizza', () => {
  it('um sabor: preço do sabor no tamanho', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa', catalogo, regra: 'media' })
    expect(r).toEqual({ base: 89, saborNome: 'Calabresa' })
  })

  it('dois sabores com regra media', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Portuguesa', catalogo, regra: 'media' })
    expect(r).toEqual({ base: 94, saborNome: 'Calabresa / Portuguesa' })
  })

  it('dois sabores com regra maior', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Portuguesa', catalogo, regra: 'maior' })
    expect(r.base).toBe(99)
  })

  it('recusa mais sabores do que o tamanho permite', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_PEQUENA, saborTexto: 'Calabresa / Portuguesa', catalogo, regra: 'media' }),
    ).toThrow(/Pequena.*1 sabor/i)
  })

  it('recusa sabor que não existe', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Frango', catalogo, regra: 'media' }),
    ).toThrow(/"Frango"/)
  })

  it('recusa sabor pausado', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Atum', catalogo, regra: 'media' }),
    ).toThrow(/"Atum"/)
  })

  it('recusa sabor repetido', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Calabresa', catalogo, regra: 'media' }),
    ).toThrow(/repetido/i)
  })

  it('recusa sabor sem preço nesse tamanho', () => {
    const soBrotinho: SaborCatalogo[] = [{ nome: 'Brot 2 Amores', status: 'disponivel', precoPorTamanho: new Map([['tam-brot', 49]]) }]
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Brotinho', tamanho: TAM_GRANDE, saborTexto: 'Brot 2 Amores', catalogo: soBrotinho, regra: 'media' }),
    ).toThrow(/não é vendido no tamanho "Grande"/i)
  })

  it('recusa texto de sabor vazio', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: '', catalogo, regra: 'media' }),
    ).toThrow(/Selecione.*sabor/i)
  })

  it('devolve o nome normalizado do catálogo, não o que o cliente mandou', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'calabresa / PORTUGUESA', catalogo, regra: 'media' })
    expect(r.saborNome).toBe('Calabresa / Portuguesa')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- lib/queries/pedidos-pizza.test.ts`
Expected: FAIL — `Failed to resolve import "./pedidos-pizza"`

- [ ] **Step 3: Escrever o módulo**

Crie `lib/queries/pedidos-pizza.ts`:

```ts
import { precoPizzaSabores, separarSabores, juntarSabores, type RegraPrecoPizza } from '@/lib/pizza-preco'

export interface SaborCatalogo {
  nome: string
  status: string
  /** tamanho_padrao_id → preço. Sabor sem entrada pro tamanho não é vendido nele. */
  precoPorTamanho: Map<string, number>
}

export interface TamanhoCatalogo {
  id: string
  nome: string
  maxSabores: number
}

export interface ResolverPizzaArgs {
  itemNome: string
  tamanho: TamanhoCatalogo
  /** O que veio da sacola: um nome, ou vários juntos por " / ". */
  saborTexto: string
  catalogo: SaborCatalogo[]
  regra: RegraPrecoPizza
}

/** Comparação de nome tolerante a caixa e acento — o cliente manda o que a tela mostrou. */
function chave(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()
}

/**
 * Server-authoritative: o preço da pizza nunca vem do cliente. A sacola manda
 * tamanho e sabores por NOME, e aqui se confere tudo contra o catálogo do
 * tenant antes de calcular.
 */
export function resolverPizza({ itemNome, tamanho, saborTexto, catalogo, regra }: ResolverPizzaArgs): { base: number; saborNome: string } {
  const pedidos = separarSabores(saborTexto)
  if (pedidos.length === 0) throw new Error(`Selecione o sabor da pizza "${itemNome}"`)

  if (pedidos.length > tamanho.maxSabores) {
    const limite = tamanho.maxSabores === 1 ? '1 sabor' : `${tamanho.maxSabores} sabores`
    throw new Error(`O tamanho "${tamanho.nome}" aceita no máximo ${limite}.`)
  }

  const vistos = new Set<string>()
  const nomes: string[] = []
  const precos: number[] = []

  for (const pedido of pedidos) {
    const k = chave(pedido)
    if (vistos.has(k)) throw new Error(`Sabor repetido na pizza "${itemNome}": "${pedido}".`)
    vistos.add(k)

    const sabor = catalogo.find((s) => chave(s.nome) === k)
    if (!sabor || sabor.status !== 'disponivel') {
      throw new Error(`Sabor "${pedido}" não está disponível no item "${itemNome}".`)
    }
    const preco = sabor.precoPorTamanho.get(tamanho.id)
    if (preco === undefined) {
      throw new Error(`O sabor "${sabor.nome}" não é vendido no tamanho "${tamanho.nome}".`)
    }
    nomes.push(sabor.nome)
    precos.push(preco)
  }

  return { base: precoPizzaSabores(precos, regra), saborNome: juntarSabores(nomes) }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- lib/queries/pedidos-pizza.test.ts`
Expected: PASS (10 testes)

- [ ] **Step 5: Ligar o módulo em `criarPedido`**

Em `lib/queries/pedidos.ts`, importe no topo:

```ts
import { resolverPizza, type SaborCatalogo, type TamanhoCatalogo } from './pedidos-pizza'
import type { RegraPrecoPizza } from '@/lib/pizza-preco'
```

Na linha 900, acrescente `pizza_calculo_preco` ao `.select(...)` do `restaurantes`:

```ts
    .select('status_loja, horario_funcionamento, aceita_entrega, aceita_retirada, pizza_calculo_preco')
```

No bloco `precisaCatalogoPizza` (linha 934), troque o select de tamanhos e monte a regra:

```ts
  const precisaCatalogoPizza = (itensDb ?? []).some((i) => i.tipo_item === 'pizza')
  const regraPizza: RegraPrecoPizza = lojaRow.pizza_calculo_preco === 'maior' ? 'maior' : 'media'
  let tamanhosPizza: TamanhoCatalogo[] = []
  let bordasPizza: { nome: string; preco: number }[] = []
  let massasPizza: { nome: string; preco: number }[] = []
  if (precisaCatalogoPizza) {
    const [tamanhosRes, bordasRes, massasRes] = await Promise.all([
      admin.from('tamanhos_padrao_pizza').select('id, nome, max_sabores').eq('restaurante_id', restauranteId),
      admin.from('bordas_pizza').select('nome, preco').eq('restaurante_id', restauranteId),
      admin.from('massas_pizza').select('nome, preco').eq('restaurante_id', restauranteId),
    ])
    tamanhosPizza = (tamanhosRes.data ?? []).map((t) => ({
      id: t.id,
      nome: t.nome,
      maxSabores: Math.max(1, Number(t.max_sabores ?? 1)),
    }))
    bordasPizza = (bordasRes.data ?? []).map((b) => ({ nome: b.nome, preco: Number(b.preco) }))
    massasPizza = (massasRes.data ?? []).map((m) => ({ nome: m.nome, preco: Number(m.preco) }))
  }
```

E substitua o ramo `if (item.tipo_item === 'pizza') { … }` (linhas 961-979) por:

```ts
    if (item.tipo_item === 'pizza') {
      if (!linha.tamanhoNome) throw new Error(`Selecione o tamanho da pizza "${item.nome}"`)
      const tamanho = tamanhosPizza.find((t) => t.nome === linha.tamanhoNome)
      if (!tamanho) throw new Error(`Tamanho "${linha.tamanhoNome}" não encontrado`)

      const catalogo: SaborCatalogo[] = (item.pizza_sabores ?? []).map(
        (s: { nome: string; status: string; pizza_sabor_precos: { tamanho_padrao_id: string; preco: number }[] }) => ({
          nome: s.nome,
          status: s.status,
          precoPorTamanho: new Map(s.pizza_sabor_precos.map((p) => [p.tamanho_padrao_id, Number(p.preco)])),
        }),
      )

      const resolvido = resolverPizza({
        itemNome: item.nome,
        tamanho,
        saborTexto: linha.saborNome ?? '',
        catalogo,
        regra: regraPizza,
      })
      base = resolvido.base
      tamanhoNome = tamanho.nome
      saborNome = resolvido.saborNome

      if (linha.bordaNome) {
        const borda = bordasPizza.find((b) => b.nome === linha.bordaNome)
        if (borda) { base += borda.preco; bordaNome = borda.nome }
      }
      if (linha.massaNome) {
        const massa = massasPizza.find((m) => m.nome === linha.massaNome)
        if (massa) { base += massa.preco; massaNome = massa.nome }
      }
    } else if (linha.tamanhoNome) {
```

- [ ] **Step 6: Rodar a suíte toda**

Run: `npm test`
Expected: PASS. Se algum teste antigo de pedido quebrar por causa do `select` novo, ajuste o mock daquele teste pra devolver `pizza_calculo_preco` e `max_sabores`.

- [ ] **Step 7: Commit**

```bash
git add lib/queries/pedidos-pizza.ts lib/queries/pedidos-pizza.test.ts lib/queries/pedidos.ts
git commit -m "feat(pizza): valida e precifica pizza multi-sabor no servidor"
```

---

### Task 5: Vitrine — escolher vários sabores e esconder tamanho sem preço

**Files:**
- Modify: `app/loja/[slug]/vitrine.tsx` (estado nas linhas 1376-1377; reset em 1389 e 1437-1441; validação em 1493; preço em 1518-1528; `addToCart` em 1555-1557; UI de tamanho/sabor em 3176-3212)

**Interfaces:**
- Consumes: `precoPizzaSabores`, `juntarSabores` (Task 2); `TamanhoPadraoPizza.maxSabores` (Task 3); `RestauranteVitrine.pizzaCalculoPreco` (Task 3).
- Produces: nada pra outras tasks. `CartLine.saborNome` passa a poder conter `" / "`.

- [ ] **Step 1: Trocar o estado de sabor único por lista**

No topo do arquivo, junto dos outros imports:

```ts
import { precoPizzaSabores, juntarSabores } from '@/lib/pizza-preco'
```

Linha 1377, troque:

```ts
  const [selectedSaborId, setSelectedSaborId] = useState<string | null>(null)
```

por:

```ts
  // Ordem importa: é a ordem em que o sabor aparece no nome ("Calabresa / Frango").
  const [selectedSaborIds, setSelectedSaborIds] = useState<string[]>([])
```

- [ ] **Step 2: Ajustar os três pontos de reset**

Linha 1389 (`openProduct`), troque `setSelectedSaborId(item.sabores.find(...)?.id ?? null)` por:

```ts
    setSelectedSaborIds([])
```

Linha 1438 (edição de linha da sacola), troque por:

```ts
      const nomes = line.saborNome ? line.saborNome.split(' / ') : []
      setSelectedSaborIds(nomes.map((n) => item.sabores.find((s) => s.nome === n)?.id).filter((id): id is string => !!id))
```

Linha 1441 (fallback), troque por:

```ts
      setSelectedSaborIds([])
```

Na linha 1449, a checagem `saborSumiu` passa a olhar cada sabor:

```ts
    const nomesAntigos = line.saborNome ? line.saborNome.split(' / ') : []
    const saborSumiu =
      item.tipoItem === 'pizza' &&
      nomesAntigos.length > 0 &&
      !nomesAntigos.every((n) => item.sabores.some((s) => s.nome === n && s.status === 'disponivel'))
```

- [ ] **Step 3: Filtrar os tamanhos que o item realmente vende**

Logo depois de `const selectedTamanho = …` (linha 1517), acrescente:

```ts
  // Brotinho e Promocional só têm preço em um tamanho. Sem esse filtro a ficha
  // ofereceria os outros tamanhos por R$ 0,00.
  const tamanhosDoItem = useMemo(() => {
    if (!productSheet || productSheet.tipoItem !== 'pizza') return tamanhosPizza
    const comPreco = tamanhosPizza.filter((t) =>
      productSheet.sabores.some((s) => (s.precos.find((p) => p.tamanhoPadraoId === t.id)?.preco ?? 0) > 0),
    )
    return comPreco.length > 0 ? comPreco : tamanhosPizza
  }, [productSheet, tamanhosPizza])
```

Substitua **todas** as leituras de `tamanhosPizza` dentro da ficha do produto por `tamanhosDoItem`: linhas 1389, 1437, 1440, 1555 e o `.map` da UI na linha 3179. O estado global `tamanhosPizza` continua sendo o catálogo cru vindo do banco.

- [ ] **Step 4: Recalcular preço e validação**

Troque o bloco das linhas 1518-1528 por:

```ts
  const selectedSabores = selectedSaborIds
    .map((id) => productSheet?.sabores.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
  const selectedBorda = bordasPizza.find((b) => b.id === selectedBordaId) ?? null
  const selectedMassa = massasPizza.find((m) => m.id === selectedMassaId) ?? null
  const tamanhoPizzaAtual = tamanhosDoItem.find((t) => t.id === selectedTamanhoPizzaId) ?? null
  const maxSaboresAtual = tamanhoPizzaAtual?.maxSabores ?? 1
  const precoSaborTamanho = precoPizzaSabores(
    selectedSabores.map((s) => s.precos.find((p) => p.tamanhoPadraoId === selectedTamanhoPizzaId)?.preco ?? 0),
    restaurante?.pizzaCalculoPreco ?? 'media',
  )
```

Na linha 1493, a regra de "pode adicionar":

```ts
    if (productSheet.tipoItem === 'pizza' && (!selectedTamanhoPizzaId || selectedSaborIds.length === 0)) return false
```

e acrescente `selectedSaborIds` ao array de dependências do `useMemo` da linha 1499 (no lugar de `selectedSaborId`).

Na linha 1556, dentro de `addToCart`:

```ts
      saborNome: juntarSabores(selectedSabores.map((s) => s.nome)),
```

- [ ] **Step 5: Aparar a seleção quando o cliente troca pra um tamanho menor**

Logo depois do bloco do Step 4, acrescente:

```ts
  // Trocar Grande (3 sabores) por Pequena (1 sabor) tem que descartar o excesso,
  // senão a ficha mostraria um preço que o servidor vai recusar.
  useEffect(() => {
    setSelectedSaborIds((prev) => (prev.length > maxSaboresAtual ? prev.slice(0, maxSaboresAtual) : prev))
  }, [maxSaboresAtual])
```

- [ ] **Step 6: Trocar a UI de sabor**

Substitua o bloco da linha 3193 (`<GrupoHeader titulo="Sabor" …>` e o `.map` que vem logo abaixo) por:

```tsx
                    <div className="mt-5" />
                    <GrupoHeader
                      titulo={maxSaboresAtual > 1 ? 'Sabores' : 'Sabor'}
                      regra={maxSaboresAtual > 1 ? `Escolha até ${maxSaboresAtual}` : 'Escolha 1'}
                      obrigatorio
                      contador={`${selectedSaborIds.length}/${maxSaboresAtual}`}
                      atendido={selectedSaborIds.length > 0}
                    />
                    {productSheet.sabores
                      .filter((s) => s.status === 'disponivel')
                      .filter((s) => (s.precos.find((p) => p.tamanhoPadraoId === selectedTamanhoPizzaId)?.preco ?? 0) > 0)
                      .map((sabor) => {
                        const posicao = selectedSaborIds.indexOf(sabor.id)
                        const isSelected = posicao >= 0
                        const cheio = selectedSaborIds.length >= maxSaboresAtual
                        const preco = sabor.precos.find((p) => p.tamanhoPadraoId === selectedTamanhoPizzaId)?.preco ?? 0
                        return (
                          <button
                            key={sabor.id}
                            disabled={!isSelected && cheio}
                            onClick={() =>
                              setSelectedSaborIds((prev) => {
                                if (prev.includes(sabor.id)) return prev.filter((id) => id !== sabor.id)
                                if (maxSaboresAtual === 1) return [sabor.id]
                                if (prev.length >= maxSaboresAtual) return prev
                                return [...prev, sabor.id]
                              })
                            }
                            className="relative -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 overflow-hidden rounded border-b border-border px-2 py-2.5 text-left last:border-none disabled:opacity-40"
                          >
                            <FlashSelecao ativo={isSelected} />
                            <div className="relative flex-1">
                              <div className="text-[14.5px] font-semibold leading-snug">{sabor.nome}</div>
                              {sabor.descricao && <div className="mt-0.5 text-[12px] leading-snug text-text-subtle">{sabor.descricao}</div>}
                            </div>
                            <span className={['relative flex-shrink-0 text-[14px] font-bold transition-colors', isSelected ? 'text-promo' : 'text-text-main'].join(' ')}>{brl(preco)}</span>
                            <span
                              className={[
                                'relative flex h-5 w-5 flex-shrink-0 items-center justify-center border-2 text-[11px] font-bold text-white transition-colors',
                                maxSaboresAtual > 1 ? 'rounded-menuzia' : 'rounded-full',
                                isSelected ? 'border-promo bg-promo' : 'border-border',
                              ].join(' ')}
                            >
                              {isSelected && (maxSaboresAtual > 1 ? posicao + 1 : <span className="h-2 w-2 rounded-full bg-white" />)}
                            </span>
                          </button>
                        )
                      })}
                    {maxSaboresAtual > 1 && selectedSabores.length > 1 && (
                      <p className="mt-2 rounded-menuzia bg-bg-alert px-3 py-2 text-[12px] font-medium leading-relaxed text-text-alert">
                        {selectedSabores.length} sabores — o preço é a {restaurante?.pizzaCalculoPreco === 'maior' ? 'do sabor mais caro' : 'média dos sabores escolhidos'}.
                      </p>
                    )}
```

- [ ] **Step 7: Conferir no app rodando**

Run: `npm run dev` (com o dev server parado antes — memória `project_ambiente_testes`)
Abra a vitrine de uma loja com pizza e confirme, na ficha do produto:
1. Tamanho com `max_sabores = 1` mostra "Escolha 1" e radio redondo; escolher outro sabor troca o anterior.
2. Depois de subir `max_sabores` pra 2 no admin, o mesmo tamanho passa a "Escolha até 2", com quadradinho numerado 1 e 2.
3. Escolher 2 sabores de preços diferentes mostra a média no botão de adicionar.
4. Trocar pro tamanho de 1 sabor derruba o segundo sabor sozinho.

- [ ] **Step 8: Commit**

```bash
git add app/loja/\[slug\]/vitrine.tsx
git commit -m "feat(vitrine): pizza meio a meio e tamanho escondido quando nao tem preco"
```

---

### Task 6: PDV — mesma seleção múltipla no balcão

**Files:**
- Modify: `app/admin/pdv/page.tsx` (tipos nas linhas 33 e 44; `pizzaReady` linha 125; `faltando` linha 140; montagem da linha 170; UI de sabor 239-243; `tamanhosPizza` 1146)

**Interfaces:**
- Consumes: `precoPizzaSabores`, `juntarSabores`, `separarSabores` (Task 2); `TamanhoPadraoPizza.maxSabores` (Task 3).
- Produces: nada.

O PDV guarda `state.saborNome: string`. Mantenha o **mesmo tipo** (texto junto) — só a UI passa a escrever vários nomes nele. Assim nada muda em `criarPedido` nem no resumo da comanda.

- [ ] **Step 1: Deixar a UI de sabor multi-seleção**

No componente da ficha (perto da linha 239), troque o `onClick` de sabor por um toggle sobre o texto:

```tsx
                      onClick={() => {
                        const atuais = state.saborNome ? state.saborNome.split(' / ') : []
                        const maxSab = tamanhosPizza.find((t) => t.nome === state.tamanhoNome)?.maxSabores ?? 1
                        let proximos: string[]
                        if (atuais.includes(s.nome)) proximos = atuais.filter((n) => n !== s.nome)
                        else if (maxSab === 1) proximos = [s.nome]
                        else if (atuais.length >= maxSab) proximos = atuais
                        else proximos = [...atuais, s.nome]
                        onChange({ saborNome: proximos.join(' / ') })
                      }}
```

e a classe de "selecionado" (linha 242) passa a testar pertinência:

```tsx
                        (state.saborNome ? state.saborNome.split(' / ') : []).includes(s.nome)
```

- [ ] **Step 2: Mostrar o limite no cabeçalho da lista de sabores**

Acima do `.map` de sabores, acrescente:

```tsx
              {(() => {
                const maxSab = tamanhosPizza.find((t) => t.nome === state.tamanhoNome)?.maxSabores ?? 1
                const qtd = state.saborNome ? state.saborNome.split(' / ').length : 0
                return (
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                    <span>{maxSab > 1 ? `Sabores (até ${maxSab})` : 'Sabor'}</span>
                    <span>{qtd}/{maxSab}</span>
                  </div>
                )
              })()}
```

- [ ] **Step 3: Aparar ao trocar de tamanho**

No handler que muda `tamanhoNome` (linha 212, dentro do `.map` de `tamanhosPizza`), troque o `onChange` por:

```tsx
                    onClick={() => {
                      const maxSab = t.maxSabores
                      const atuais = state.saborNome ? state.saborNome.split(' / ') : []
                      onChange({ tamanhoNome: t.nome, saborNome: atuais.slice(0, maxSab).join(' / ') })
                    }}
```

- [ ] **Step 4: Verificar o preço exibido**

O PDV calcula o preço da linha localmente. Onde ele hoje pega o preço do único sabor, troque por:

```ts
  const nomesSabor = state.saborNome ? state.saborNome.split(' / ') : []
  const tamPizza = tamanhosPizza.find((t) => t.nome === state.tamanhoNome)
  const precoPizza = precoPizzaSabores(
    nomesSabor
      .map((n) => item.sabores.find((s) => s.nome === n))
      .map((s) => s?.precos.find((p) => p.tamanhoPadraoId === tamPizza?.id)?.preco ?? 0),
    regraPizza,
  )
```

`regraPizza` vem da loja carregada no PDV; se o componente ainda não tiver a loja, carregue `pizza_calculo_preco` junto com `tamanhosPizza` (linha 675) e passe por prop.

- [ ] **Step 5: Conferir no app**

Run: `npm run dev`
No PDV, monte uma pizza Grande com 2 sabores e confira que o total bate com a média, e que a comanda mostra "Calabresa / Portuguesa".

- [ ] **Step 6: Commit**

```bash
git add app/admin/pdv/page.tsx
git commit -m "feat(pdv): pizza meio a meio no balcao"
```

---

### Task 7: Admin — campo "máx. sabores" e seletor da regra de preço

**Files:**
- Modify: `app/admin/cardapio/page.tsx` (`ListaCatalogo` 1270-1330; aba Tamanhos 1459-1480)

**Interfaces:**
- Consumes: `criarTamanhoPadraoPizza(..., maxSabores)` e `atualizarTamanhoPadraoPizza(..., maxSabores)` (Task 3).
- Produces: nada.

- [ ] **Step 1: Dar um segundo campo opcional ao `ListaCatalogo`**

Nas props (linha 1282), acrescente:

```ts
  /** Segundo campo opcional (ex.: "máx. sabores" no tamanho de pizza). */
  extra2Label?: string
  extra2Placeholder?: string
  formatExtra2?: (extra2: string) => string
```

Em `LinhaCatalogo`, acrescente `extra2?: string`. Adicione os estados `editExtra2` / `newExtra2` ao lado dos de `extra`, inclua `extra2` nas assinaturas de `onAdd` / `onUpdate` (como último parâmetro, opcional) e renderize o input só quando `extra2Label` vier definido, com a mesma classe do input de `extra`.

- [ ] **Step 2: Usar o campo na lista de tamanhos de pizza**

Na aba Tamanhos (linha 1459), troque a chamada por:

```tsx
        <ListaCatalogo
          titulo="Tamanhos de pizza"
          hint='Ex.: "Pequena" com 4 fatias e 1 sabor, "Grande" com 8 fatias e até 3 sabores. Cada sabor define o preço para cada um desses tamanhos.'
          itens={tamanhosPizza.map((t) => ({ id: t.id, nome: t.nome, extra: String(t.fatias), extra2: String(t.maxSabores) }))}
          extraLabel="Fatias"
          extraPlaceholder="Ex: 8"
          extraType="number"
          formatExtra={(e) => `${e} fatias`}
          extra2Label="Máx. sabores"
          extra2Placeholder="Ex: 3"
          formatExtra2={(e) => (Number(e) > 1 ? `até ${e} sabores` : '1 sabor')}
          onAdd={async (nome, extra, extra2) => {
            const novo = await criarTamanhoPadraoPizza(supabase, restauranteId, nome, Number(extra) || 0, tamanhosPizza.length, Math.max(1, Number(extra2) || 1))
            setTamanhosPizza((prev) => [...prev, novo])
          }}
          onUpdate={async (id, nome, extra, extra2) => {
            const maxSab = Math.max(1, Number(extra2) || 1)
            await atualizarTamanhoPadraoPizza(supabase, id, nome, Number(extra) || 0, maxSab)
            setTamanhosPizza((prev) => prev.map((t) => (t.id === id ? { ...t, nome, fatias: Number(extra) || 0, maxSabores: maxSab } : t)))
          }}
          onRemove={async (id) => {
            if (!confirm('Excluir este tamanho de pizza? Preços de sabores cadastrados pra ele também serão excluídos.')) return
            await removerTamanhoPadraoPizza(supabase, id)
            setTamanhosPizza((prev) => prev.filter((t) => t.id !== id))
          }}
        />
```

- [ ] **Step 3: Seletor da regra de preço**

Logo abaixo do parágrafo azul de hint da aba Tamanhos (linha 1453), acrescente:

```tsx
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[12px] font-semibold text-text-main">Pizza com mais de um sabor cobra:</span>
          {(['media', 'maior'] as const).map((regra) => (
            <button
              key={regra}
              onClick={async () => {
                await supabase.from('restaurantes').update({ pizza_calculo_preco: regra }).eq('id', restauranteId)
                setRegraPizza(regra)
              }}
              className={[
                'rounded-menuzia border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                regraPizza === regra ? 'border-primary bg-primary text-white' : 'border-border bg-bg-main text-text-subtle',
              ].join(' ')}
            >
              {regra === 'media' ? 'Média dos sabores' : 'Sabor mais caro'}
            </button>
          ))}
        </div>
```

Adicione o estado `const [regraPizza, setRegraPizza] = useState<'media' | 'maior'>('media')` ao componente da aba e carregue o valor atual no mesmo `useEffect` que já busca tamanhos, bordas e massas (linha ~1435):

```ts
      const { data: loja } = await supabase.from('restaurantes').select('pizza_calculo_preco').eq('id', restauranteId).single()
      setRegraPizza(loja?.pizza_calculo_preco === 'maior' ? 'maior' : 'media')
```

- [ ] **Step 4: Conferir que a tipagem fecha**

Run: `npx tsc --noEmit`
Expected: sem erros (os erros anotados na Task 3 Step 4 devem ter sumido).

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Conferir no app**

Run: `npm run dev`
Em Cardápio → Tamanhos: crie "Grande" com 8 fatias e 3 sabores, troque a regra pra "Média dos sabores", recarregue a página e confirme que os dois persistiram.

- [ ] **Step 6: Commit + push**

```bash
git add app/admin/cardapio/page.tsx
git commit -m "feat(admin): max de sabores por tamanho e regra de preco de pizza"
git push origin main
```

---

## Parte B — Import do cardápio da Pizza do Rosa

### Task 8: Extrair o cardápio da origem pra um JSON versionado

**Files:**
- Create: `scripts/import-pizza-do-rosa/extrair.mjs`
- Create: `scripts/import-pizza-do-rosa/README.md`
- Create (gerado): `scripts/import-pizza-do-rosa/dados/cardapio-origem.json`

**Interfaces:**
- Consumes: nada (rede).
- Produces: `dados/cardapio-origem.json` com a forma:

```ts
{
  sessoes: Array<{
    sessaoId: string
    nome: string
    link: string
    especifico: 'S' | 'N'
    formaCalculoItem: string
    itens: Array<{ coditem: string | null; nome: string; descricao: string; preco: string; imagem: string | null; subcategoria: string }>
    api: null | {                       // só pras sessões especifico=S
      tamanhos: Array<{ id: string; descricao: string; maxSabores: number[] }>
      adicionais: Array<{ nome: string; precoPorTamanho: Record<string, string> }>
      precosPorItem: Record<string, Array<{ sizeId: string; sizeName: string; price: string }>>
    }
  }>
  bordas: Array<{ nome: string; preco: string }>
  tamanhosPizza: Array<{ id: string; nome: string; fatias: string; maxSabores: number }>
}
```

- [ ] **Step 1: Escrever o extrator**

Crie `scripts/import-pizza-do-rosa/extrair.mjs`. Pontos que **não** são óbvios e já foram descobertos:

- A API `/exec/menu/getItemsBySession?sessionId=<id>` só responde com corpo se a requisição levar **cookie de sessão** (`__Secure-PHPSESSID`, obtido num GET prévio à home) **e** o header `Referer: https://www.pizzadorosa.com.br/cardapio/`. Sem o Referer ela devolve 200 com corpo vazio.
- A lista de sessões está no HTML de `/cardapio/` dentro de `<input type="hidden" id="sessions" value='<json>'>`, com entidades HTML escapadas (`&quot;`, `&#039;`, `&amp;`).
- Os itens estão em `/cardapio/itens/<link>` como cards `itemscope itemtype='http://schema.org/Product'`; a subcategoria vem do heading anterior (`id='itenscategs_<catId>_<n>'`).
- Bordas e tamanhos de pizza vêm de `/montar/pizza/` como `var bordas_lista = [...]` e `var alltamanho = [...]` (parser de chaves balanceadas, respeitando string e escape).
- Foto: o `src` do card vem em `/180/`. Trocar por `/800/` pra ter a versão grande.
- Rodar com `User-Agent` de Android e `?dvc=mobile&ed_mobile_iframe=1`, senão volta o wrapper desktop.

```js
import fs from 'fs'
import path from 'path'

const BASE = 'https://www.pizzadorosa.com.br'
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36'
const DADOS = path.join(import.meta.dirname, 'dados')

let cookie = ''

async function get(url, comReferer = false) {
  const headers = { 'User-Agent': UA }
  if (cookie) headers['Cookie'] = cookie
  if (comReferer) {
    headers['Referer'] = `${BASE}/cardapio/`
    headers['X-Requested-With'] = 'XMLHttpRequest'
  }
  const r = await fetch(url, { headers })
  const setCookie = r.headers.getSetCookie?.() ?? []
  for (const c of setCookie) {
    const par = c.split(';')[0]
    if (par.startsWith('__Secure-PHPSESSID')) cookie = cookie ? `${cookie}; ${par}` : par
  }
  return r.text()
}

const dec = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/** Lê `var <nome> = [...]` / `{...}` respeitando strings e escapes. */
function varJson(html, nome) {
  const i = html.indexOf('var ' + nome + ' =')
  if (i < 0) return null
  let j = html.indexOf('=', i) + 1
  while (' \t\n'.includes(html[j])) j++
  const open = html[j]
  if (open !== '[' && open !== '{') return null
  const close = open === '[' ? ']' : '}'
  const BS = String.fromCharCode(92)
  let depth = 0, inStr = false, esc = false, k = j
  for (; k < html.length; k++) {
    const c = html[k]
    if (esc) { esc = false; continue }
    if (c === BS) { esc = true; continue }
    if (inStr) { if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) { k++; break } }
  }
  return JSON.parse(html.slice(j, k))
}

function parseItens(html) {
  const itens = []
  const catRe = /id='itenscategs_(\d+)_\d+'><h2[^>]*>(?:<i[^>]*>[^<]*<\/i>)?\s*([^<]+)<\/h2>/g
  const cortes = []
  let cm
  while ((cm = catRe.exec(html))) cortes.push({ nome: dec(cm[2]).trim(), start: cm.index })
  if (cortes.length === 0) cortes.push({ nome: '', start: 0 })
  cortes.forEach((c, i) => { c.end = i + 1 < cortes.length ? cortes[i + 1].start : html.length })

  for (const corte of cortes) {
    const partes = html.slice(corte.start, corte.end).split(/<div\s+itemscope itemtype='http:\/\/schema\.org\/Product'/).slice(1)
    for (const p of partes) {
      const dados = (p.match(/data-dadositem='([^']+)'/) || [])[1]
      let d = {}
      if (dados) { try { d = JSON.parse(dec(dados)) } catch { d = {} } }
      const nome = (p.match(/itemprop='name'[^>]*>([\s\S]*?)<\/p>/) || [])[1] || d.nomeitem
      if (!nome) continue
      const img = (p.match(/<img[^>]*itemprop='image'[^>]*src='([^']+)'/) || [])[1] || null
      itens.push({
        coditem: d.coditem ?? null,
        nome: dec(nome).trim(),
        descricao: dec((p.match(/class='desc-item-menu'>([\s\S]*?)<\/p>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim(),
        preco: (p.match(/itemprop='price' content='([^']+)'/) || [])[1] || d.precoitem || null,
        imagem: img ? img.replace('/180/', '/800/') : null,
        subcategoria: corte.nome,
      })
    }
  }
  return itens
}

async function main() {
  fs.mkdirSync(DADOS, { recursive: true })
  await get(`${BASE}/?dvc=mobile&ed_mobile_iframe=1`) // pega o cookie de sessão

  const cardapioHtml = await get(`${BASE}/cardapio/?dvc=mobile&ed_mobile_iframe=1`)
  const sessions = JSON.parse(dec(cardapioHtml.match(/id="sessions" value='([\s\S]*?)'>/)[1]))

  const sessoes = []
  for (const s of sessions) {
    const html = await get(`${BASE}/cardapio/itens/${s.sessao_link}?dvc=mobile&ed_mobile_iframe=1`)
    let api = null
    if (s.sessao_especifico === 'S') {
      const txt = await get(`${BASE}/exec/menu/getItemsBySession?sessionId=${s.sessao_id}`, true)
      const json = txt.length > 100 ? JSON.parse(txt) : null
      if (json?.res) {
        api = {
          tamanhos: json.data.sizes.map((t) => ({
            id: t.tamanho_id,
            descricao: t.tamanho_descricao,
            maxSabores: JSON.parse(t.tamanho_qtdmaxsabores).map(Number),
          })),
          adicionais: json.data.ingredients.map((g) => ({
            nome: g.ingrediente_nome,
            precoPorTamanho: Object.fromEntries(g.ingredientes_precotamanho.map((p) => [p.ingrediente_precotamannho_tamanhoid, p.ingrediente_precotamannho_preco])),
          })),
          precosPorItem: Object.fromEntries(
            json.data.items.map((i) => [i.name, i.priceSizes.map((p) => ({ sizeId: p.sizeId, sizeName: p.sizeName, price: p.sizePrice }))]),
          ),
        }
      }
      await new Promise((r) => setTimeout(r, 800)) // educação com o servidor alheio
    }
    sessoes.push({
      sessaoId: s.sessao_id,
      nome: s.sessao_nome,
      link: s.sessao_link,
      especifico: s.sessao_especifico,
      formaCalculoItem: s.sessao_formacalculoitem,
      itens: parseItens(html),
      api,
    })
    console.log(s.sessao_link.padEnd(20), sessoes.at(-1).itens.length, 'itens', api ? '(+api)' : '')
  }

  const montHtml = await get(`${BASE}/montar/pizza/?dvc=mobile&ed_mobile_iframe=1`)
  const bordas = (varJson(montHtml, 'bordas_lista') ?? []).map((b) => ({ nome: b.borda_nome.replace(/^Borda:\s*/, ''), preco: b.borda_preco }))
  const tamanhosPizza = (varJson(montHtml, 'alltamanho') ?? [])
    .filter((t) => t.tamanho_sessaoid === '1')
    .map((t) => ({ id: t.tamanho_id, nome: t.tamanho_nome, fatias: t.tamanho_descricao, maxSabores: JSON.parse(t.tamanho_qtdsabormaxima).length }))

  fs.writeFileSync(path.join(DADOS, 'cardapio-origem.json'), JSON.stringify({ sessoes, bordas, tamanhosPizza }, null, 2))
  console.log('bordas', bordas.length, '| tamanhos', tamanhosPizza.length)
}

main()
```

- [ ] **Step 2: Rodar o extrator**

Run: `node scripts/import-pizza-do-rosa/extrair.mjs`
Expected, exatamente:

```
pizza                75 itens (+api)
pizza-promocional    15 itens (+api)
pizza-brotinho       20 itens
hamburguers          19 itens (+api)
porcoes              10 itens (+api)
massas                6 itens (+api)
sobremesas           31 itens
bebidas              36 itens
saladas               1 itens (+api)
molhos                3 itens
congelados            2 itens
loja-virtual          9 itens
bordas 5 | tamanhos 4
```

Se qualquer contagem divergir, o cardápio da origem mudou desde 2026-09-12 — **pare e reporte**, não ajuste o número no plano.

- [ ] **Step 3: Escrever o README**

Crie `scripts/import-pizza-do-rosa/README.md` com: o que cada script faz, a ordem (`extrair` → `mapear` → `importar --dry-run` → `importar --apply`), as variáveis de ambiente lidas (`.env.local`), o aviso de que `importar --apply` escreve em produção, e como reverter (Task 11 Step 4).

- [ ] **Step 4: Commit**

```bash
git add scripts/import-pizza-do-rosa/extrair.mjs scripts/import-pizza-do-rosa/README.md scripts/import-pizza-do-rosa/dados/cardapio-origem.json
git commit -m "chore(import): extrator do cardapio da Pizza do Rosa"
```

---

### Task 9: Mapear origem → formato Menuzia

**Files:**
- Create: `scripts/import-pizza-do-rosa/mapear.mjs`
- Create: `scripts/import-pizza-do-rosa/mapear.test.mjs`
- Create (gerado): `scripts/import-pizza-do-rosa/dados/cardapio-menuzia.json`

**Interfaces:**
- Consumes: `dados/cardapio-origem.json` (Task 8).
- Produces: `export function mapear(origem): PlanoMenuzia` e `dados/cardapio-menuzia.json`:

```ts
interface PlanoMenuzia {
  tamanhosPizza: Array<{ nome: string; fatias: number; maxSabores: number; posicao: number }>
  bordas: Array<{ nome: string; preco: number; posicao: number }>
  presets: Array<{ nome: string; obrigatorio: false; minEscolhas: 0; maxEscolhas: number; itens: Array<{ nome: string; preco: number; posicao: number }> }>
  grupos: Array<{
    nome: string
    posicao: number
    itens: Array<{
      nome: string
      descricao: string
      preco: number
      imagemOrigem: string | null
      tipoItem: 'simples' | 'pizza'
      tag: string | null
      presets: string[]
      sabores?: Array<{ nome: string; descricao: string; imagemOrigem: string | null; posicao: number; precos: Array<{ tamanho: string; preco: number }> }>
    }>
  }>
}
```

- [ ] **Step 1: Escrever o teste que falha**

Crie `scripts/import-pizza-do-rosa/mapear.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { mapear } from './mapear.mjs'

const origem = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-origem.json'), 'utf8'))
const plano = mapear(origem)

describe('tamanhos de pizza', () => {
  it('cria os 4 tamanhos da origem mais o Brotinho', () => {
    expect(plano.tamanhosPizza.map((t) => t.nome)).toEqual(['Pequena', 'Média', 'Grande', 'Gigante', 'Brotinho'])
  })

  it('leva o máximo de sabores de cada tamanho', () => {
    expect(plano.tamanhosPizza.map((t) => t.maxSabores)).toEqual([1, 2, 3, 4, 1])
  })

  it('leva as fatias', () => {
    expect(plano.tamanhosPizza.map((t) => t.fatias)).toEqual([4, 6, 8, 12, 4])
  })
})

describe('bordas', () => {
  it('são 5 e todas com o preço do Grande', () => {
    expect(plano.bordas).toHaveLength(5)
    expect(plano.bordas.every((b) => b.preco === 19)).toBe(true)
    expect(plano.bordas.map((b) => b.nome)).toContain('Catupiry')
  })
})

describe('grupos', () => {
  it('tem as 15 categorias do spec, nessa ordem', () => {
    expect(plano.grupos.map((g) => g.nome)).toEqual([
      'Pizzas Salgadas', 'Pizzas Doces', 'Pizza Promocional', 'Pizza Brotinho',
      'Hambúrguers', 'Pizza Burguer', 'Porções', 'Massas', 'Saladas',
      'Sobremesas', 'Bebidas', 'Cervejas e Vinhos', 'Molhos', 'Congelados', 'Loja Virtual',
    ])
  })

  it('não perde nenhum dos 227 itens de origem', () => {
    const totalSimples = plano.grupos.flatMap((g) => g.itens).filter((i) => i.tipoItem === 'simples').length
    const totalSabores = plano.grupos.flatMap((g) => g.itens).flatMap((i) => i.sabores ?? []).length
    expect(totalSimples + totalSabores).toBe(227)
  })
})

describe('itens de pizza', () => {
  const salgadas = plano.grupos.find((g) => g.nome === 'Pizzas Salgadas').itens[0]
  const brotinho = plano.grupos.find((g) => g.nome === 'Pizza Brotinho').itens[0]
  const promo = plano.grupos.find((g) => g.nome === 'Pizza Promocional').itens[0]

  it('Pizzas Salgadas é um item pizza com 56 sabores', () => {
    expect(salgadas.tipoItem).toBe('pizza')
    expect(salgadas.sabores).toHaveLength(56)
  })

  it('cada sabor salgado tem preço nos 4 tamanhos grandes, nenhum no Brotinho', () => {
    for (const s of salgadas.sabores) {
      expect(s.precos.map((p) => p.tamanho)).toEqual(['Pequena', 'Média', 'Grande', 'Gigante'])
      expect(s.precos.every((p) => p.preco > 0)).toBe(true)
    }
  })

  it('Brotinho tem preço só no tamanho Brotinho, a R$ 49', () => {
    expect(brotinho.sabores).toHaveLength(20)
    for (const s of brotinho.sabores) {
      expect(s.precos).toEqual([{ tamanho: 'Brotinho', preco: 49 }])
    }
  })

  it('Promocional tem preço só no Gigante, a R$ 79, e tag de promoção', () => {
    expect(promo.tag).toBe('promocao')
    expect(promo.sabores).toHaveLength(15)
    for (const s of promo.sabores) {
      expect(s.precos).toEqual([{ tamanho: 'Gigante', preco: 79 }])
    }
  })

  it('os 4 itens de pizza recebem o preset de adicionais de pizza', () => {
    for (const nome of ['Pizzas Salgadas', 'Pizzas Doces', 'Pizza Promocional', 'Pizza Brotinho']) {
      expect(plano.grupos.find((g) => g.nome === nome).itens[0].presets).toContain('Adicionais de Pizza')
    }
  })
})

describe('presets de complementos', () => {
  it('cria os 5 presets', () => {
    expect(plano.presets.map((p) => p.nome).sort()).toEqual([
      'Adicionais de Hambúrguer', 'Adicionais de Massa', 'Adicionais de Pizza', 'Adicionais de Porção', 'Adicionais de Salada',
    ])
  })

  it('adicional de pizza usa a coluna do Grande', () => {
    const bacon = plano.presets.find((p) => p.nome === 'Adicionais de Pizza').itens.find((i) => i.nome === 'Bacon')
    expect(bacon.preco).toBe(9)
  })

  it('todos são opcionais e de múltipla escolha', () => {
    for (const p of plano.presets) {
      expect(p.obrigatorio).toBe(false)
      expect(p.minEscolhas).toBe(0)
      expect(p.maxEscolhas).toBeGreaterThan(1)
    }
  })
})

describe('itens simples', () => {
  it('todo item simples tem preço maior que zero', () => {
    const simples = plano.grupos.flatMap((g) => g.itens).filter((i) => i.tipoItem === 'simples')
    expect(simples.every((i) => i.preco > 0)).toBe(true)
  })

  it('todo item e todo sabor tem foto de origem', () => {
    const itens = plano.grupos.flatMap((g) => g.itens)
    expect(itens.filter((i) => i.tipoItem === 'simples').every((i) => !!i.imagemOrigem)).toBe(true)
    expect(itens.flatMap((i) => i.sabores ?? []).every((s) => !!s.imagemOrigem)).toBe(true)
  })

  it('nenhum nome de sabor contém o separador " / "', () => {
    const sabores = plano.grupos.flatMap((g) => g.itens).flatMap((i) => i.sabores ?? [])
    expect(sabores.filter((s) => s.nome.includes(' / '))).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run scripts/import-pizza-do-rosa/mapear.test.mjs`
Expected: FAIL — `Failed to resolve import "./mapear.mjs"`

- [ ] **Step 3: Escrever o mapeador**

Crie `scripts/import-pizza-do-rosa/mapear.mjs`. Regras de mapeamento, todas já decididas no spec:

- Tamanhos: os 4 de `origem.tamanhosPizza` renomeados de "Pizza Pequena" → "Pequena" (tira o prefixo), `fatias` extraído do texto `"4 Fatias"`, mais um quinto tamanho `Brotinho` (4 fatias, 1 sabor) que não existe na origem.
- Bordas: `origem.bordas`, todas com preço fixo `19` (coluna do Grande — decisão #2 do spec).
- Sessão `pizza` vira **dois** itens de pizza, separados pela subcategoria do item: `Tradicionais` → grupo "Pizzas Salgadas", `Doces` → grupo "Pizzas Doces". Preço de cada sabor vem de `api.precosPorItem[nome]`, mapeando `sizeName` (`"Pizza Pequena"` etc.) pro nome novo.
- Sessão `pizza-promocional` vira 1 item pizza com preço só em `Gigante` (todos R$ 79) e `tag = 'promocao'`.
- Sessão `pizza-brotinho` vira 1 item pizza com preço só em `Brotinho` (todos R$ 49, vindo do preço do item na listagem).
- Sessão `hamburguers` vira dois grupos pela subcategoria: `Hambúrguers` e `Pizza Burguer`.
- Sessão `bebidas` vira dois grupos: subcategorias `Refrigerante`/`Suco`/`Água` → "Bebidas"; `Cerveja`/`vinho` → "Cervejas e Vinhos".
- Demais sessões viram um grupo cada, com o nome da tabela 4.2 do spec.
- Presets: um por sessão com `api.adicionais` não vazio. Preço = `precoPorTamanho` do tamanho **Grande** quando a sessão é pizza (id `15`); nas outras, o único preço existente. `maxEscolhas` = quantidade de itens do preset.
- Nome do item/sabor: usar como veio da origem, apenas com `trim()`. Não normalizar caixa — a origem já vem em Title Case.

```js
import fs from 'fs'
import path from 'path'

const NOME_TAMANHO = { 'Pizza Pequena': 'Pequena', 'Pizza Média': 'Média', 'Pizza Grande': 'Grande', 'Pizza Gigante': 'Gigante' }
const ID_TAMANHO_GRANDE = '15'
const PRECO_BORDA = 19

const num = (v) => Math.round(Number(v) * 100) / 100

function tamanhos(origem) {
  const base = origem.tamanhosPizza.map((t, i) => ({
    nome: NOME_TAMANHO[t.nome] ?? t.nome,
    fatias: parseInt(t.fatias, 10) || 0,
    maxSabores: t.maxSabores,
    posicao: i,
  }))
  return [...base, { nome: 'Brotinho', fatias: 4, maxSabores: 1, posicao: base.length }]
}

function presets(origem) {
  const rotulo = {
    pizza: 'Adicionais de Pizza',
    hamburguers: 'Adicionais de Hambúrguer',
    massas: 'Adicionais de Massa',
    porcoes: 'Adicionais de Porção',
    saladas: 'Adicionais de Salada',
  }
  const saida = []
  for (const s of origem.sessoes) {
    const nome = rotulo[s.link]
    if (!nome || !s.api?.adicionais?.length) continue
    const itens = s.api.adicionais.map((a, i) => {
      const precos = a.precoPorTamanho
      const bruto = s.link === 'pizza' ? precos[ID_TAMANHO_GRANDE] : Object.values(precos)[0]
      return { nome: a.nome, preco: num(bruto ?? 0), posicao: i }
    })
    saida.push({ nome, obrigatorio: false, minEscolhas: 0, maxEscolhas: itens.length, itens })
  }
  return saida
}

function saborDeItem(item, precosApi, i) {
  return {
    nome: item.nome,
    descricao: item.descricao,
    imagemOrigem: item.imagem,
    posicao: i,
    precos: precosApi,
  }
}

function itemPizza(nome, itens, precosPor, tag = null) {
  return {
    nome,
    descricao: '',
    preco: 0,
    imagemOrigem: itens[0]?.imagem ?? null,
    tipoItem: 'pizza',
    tag,
    presets: ['Adicionais de Pizza'],
    sabores: itens.map((it, i) => saborDeItem(it, precosPor(it), i)),
  }
}

function itemSimples(item, presetsDoGrupo) {
  return {
    nome: item.nome,
    descricao: item.descricao,
    preco: num(item.preco),
    imagemOrigem: item.imagem,
    tipoItem: 'simples',
    tag: null,
    presets: presetsDoGrupo,
    }
}

export function mapear(origem) {
  const porLink = Object.fromEntries(origem.sessoes.map((s) => [s.link, s]))
  const grupos = []
  let pos = 0
  const add = (nome, itens) => { grupos.push({ nome, posicao: pos++, itens }) }

  // ── Pizzas salgadas e doces ──────────────────────────────────────────────
  const pizza = porLink['pizza']
  const precoPizza = (it) => {
    const linhas = pizza.api.precosPorItem[it.nome] ?? []
    return linhas
      .filter((l) => NOME_TAMANHO[l.sizeName])
      .map((l) => ({ tamanho: NOME_TAMANHO[l.sizeName], preco: num(l.price) }))
  }
  add('Pizzas Salgadas', [itemPizza('Pizza Salgada', pizza.itens.filter((i) => i.subcategoria === 'Tradicionais'), precoPizza)])
  add('Pizzas Doces', [itemPizza('Pizza Doce', pizza.itens.filter((i) => i.subcategoria === 'Doces'), precoPizza)])

  // ── Promocional: só Gigante ──────────────────────────────────────────────
  const promo = porLink['pizza-promocional']
  add('Pizza Promocional', [itemPizza('Pizza Promocional', promo.itens, (it) => [{ tamanho: 'Gigante', preco: num(it.preco) }], 'promocao')])

  // ── Brotinho: só Brotinho ────────────────────────────────────────────────
  const brot = porLink['pizza-brotinho']
  add('Pizza Brotinho', [itemPizza('Pizza Brotinho', brot.itens, (it) => [{ tamanho: 'Brotinho', preco: num(it.preco) }])])

  // ── Simples ──────────────────────────────────────────────────────────────
  const simples = [
    ['Hambúrguers', 'hamburguers', ['Hambúrguers'], ['Adicionais de Hambúrguer']],
    ['Pizza Burguer', 'hamburguers', ['Pizza Burguer'], ['Adicionais de Hambúrguer']],
    ['Porções', 'porcoes', null, ['Adicionais de Porção']],
    ['Massas', 'massas', null, ['Adicionais de Massa']],
    ['Saladas', 'saladas', null, ['Adicionais de Salada']],
    ['Sobremesas', 'sobremesas', null, []],
    ['Bebidas', 'bebidas', ['Refrigerante', 'Suco', 'Água'], []],
    ['Cervejas e Vinhos', 'bebidas', ['Cerveja', 'vinho'], []],
    ['Molhos', 'molhos', null, []],
    ['Congelados', 'congelados', null, []],
    ['Loja Virtual', 'loja-virtual', null, []],
  ]
  for (const [nomeGrupo, link, subcats, presetsDoGrupo] of simples) {
    const itens = porLink[link].itens
      .filter((i) => !subcats || subcats.includes(i.subcategoria))
      .map((i) => itemSimples(i, presetsDoGrupo))
    add(nomeGrupo, itens)
  }

  return {
    tamanhosPizza: tamanhos(origem),
    bordas: origem.bordas.map((b, i) => ({ nome: b.nome, preco: PRECO_BORDA, posicao: i })),
    presets: presets(origem),
    grupos,
  }
}

if (process.argv[1] === import.meta.filename) {
  const dir = path.join(import.meta.dirname, 'dados')
  const origem = JSON.parse(fs.readFileSync(path.join(dir, 'cardapio-origem.json'), 'utf8'))
  const plano = mapear(origem)
  fs.writeFileSync(path.join(dir, 'cardapio-menuzia.json'), JSON.stringify(plano, null, 2))
  console.log('grupos', plano.grupos.length, '| itens', plano.grupos.flatMap((g) => g.itens).length, '| sabores', plano.grupos.flatMap((g) => g.itens).flatMap((i) => i.sabores ?? []).length, '| presets', plano.presets.length)
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run scripts/import-pizza-do-rosa/mapear.test.mjs`
Expected: PASS (todos). Se "não perde nenhum dos 227 itens" falhar, alguma subcategoria ficou de fora do mapa `simples` — compare a lista de subcategorias da origem com o que está filtrado.

- [ ] **Step 5: Gerar o JSON final**

Run: `node scripts/import-pizza-do-rosa/mapear.mjs`
Expected: `grupos 15 | itens 121 | sabores 110 | presets 5`

- [ ] **Step 6: Commit**

```bash
git add scripts/import-pizza-do-rosa/mapear.mjs scripts/import-pizza-do-rosa/mapear.test.mjs scripts/import-pizza-do-rosa/dados/cardapio-menuzia.json
git commit -m "chore(import): mapeamento do cardapio da Pizza do Rosa pro formato Menuzia"
```

---

### Task 10: Script de import com dry-run

**Files:**
- Create: `scripts/import-pizza-do-rosa/importar.mjs`

**Interfaces:**
- Consumes: `dados/cardapio-menuzia.json` (Task 9); `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- Produces: linhas em `grupos_cardapio`, `itens_cardapio`, `pizza_sabores`, `pizza_sabor_precos`, `tamanhos_padrao_pizza`, `bordas_pizza`, `presets_complementos`, `preset_complemento_itens`, `grupos_item_complementos`, `item_complementos`, e objetos no bucket `cardapio`.

- [ ] **Step 1: Escrever o script**

Crie `scripts/import-pizza-do-rosa/importar.mjs`:

```js
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SLUG = 'pizza-do-rosa'
const MARCA = 'import-expresso-2026-09'   // pra achar e reverter tudo que este script criou
const APPLY = process.argv.includes('--apply')

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const plano = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-menuzia.json'), 'utf8'))

let criados = 0
function log(o, ...args) { console.log(APPLY ? '[apply]' : '[dry-run]', o, ...args) }

async function ins(tabela, linha, select = 'id') {
  criados++
  if (!APPLY) return { id: `fake-${tabela}-${criados}` }
  const { data, error } = await db.from(tabela).insert(linha).select(select).single()
  if (error) throw new Error(`${tabela}: ${error.message} — ${JSON.stringify(linha).slice(0, 200)}`)
  return data
}

/** Baixa a foto da origem e sobe pro bucket `cardapio` sob <restauranteId>/. */
async function subirImagem(restauranteId, url, nomeBase) {
  if (!url) return null
  const r = await fetch(url)
  if (!r.ok) { console.warn('  ! foto falhou', r.status, url); return null }
  const ext = (url.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase()
  const caminho = `${restauranteId}/${MARCA}/${nomeBase.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${Date.now()}.${ext}`
  if (!APPLY) return `dry-run://${caminho}`
  const buf = Buffer.from(await r.arrayBuffer())
  const { error } = await db.storage.from('cardapio').upload(caminho, buf, { contentType: r.headers.get('content-type') ?? 'image/jpeg', upsert: true })
  if (error) throw new Error(`upload ${caminho}: ${error.message}`)
  return db.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
}

async function main() {
  const { data: loja, error } = await db.from('restaurantes').select('id, nome').eq('slug', SLUG).single()
  if (error) throw error
  const rid = loja.id
  log('loja', loja.nome, rid)

  // Guarda: este script só sabe popular cardápio vazio.
  const { count } = await db.from('itens_cardapio').select('id', { count: 'exact', head: true }).eq('restaurante_id', rid)
  if (count && count > 0) throw new Error(`A loja já tem ${count} itens. Reverta antes (ver README) ou rode com a loja vazia.`)

  // ── Tamanhos de pizza ────────────────────────────────────────────────────
  const idTamanho = {}
  for (const t of plano.tamanhosPizza) {
    const row = await ins('tamanhos_padrao_pizza', { restaurante_id: rid, nome: t.nome, fatias: t.fatias, max_sabores: t.maxSabores, posicao: t.posicao })
    idTamanho[t.nome] = row.id
    log('tamanho', t.nome, `${t.fatias} fatias`, `máx ${t.maxSabores}`)
  }

  // ── Bordas ───────────────────────────────────────────────────────────────
  for (const b of plano.bordas) {
    await ins('bordas_pizza', { restaurante_id: rid, nome: b.nome, preco: b.preco, posicao: b.posicao })
    log('borda', b.nome, b.preco)
  }

  // ── Regra de preço da loja ───────────────────────────────────────────────
  if (APPLY) {
    const { error: e } = await db.from('restaurantes').update({ pizza_calculo_preco: 'media' }).eq('id', rid)
    if (e) throw e
  }
  log('regra de preço', 'media')

  // ── Presets ──────────────────────────────────────────────────────────────
  const preset = {}
  for (const p of plano.presets) {
    const row = await ins('presets_complementos', {
      restaurante_id: rid, nome: p.nome, obrigatorio: p.obrigatorio,
      min_escolhas: p.minEscolhas, max_escolhas: p.maxEscolhas, permite_quantidade: false,
    })
    preset[p.nome] = { id: row.id, itens: p.itens }
    for (const i of p.itens) await ins('preset_complemento_itens', { preset_id: row.id, nome: i.nome, preco: i.preco, posicao: i.posicao })
    log('preset', p.nome, `${p.itens.length} complementos`)
  }

  // ── Grupos, itens, sabores ───────────────────────────────────────────────
  for (const g of plano.grupos) {
    const grupo = await ins('grupos_cardapio', { restaurante_id: rid, nome: g.nome, posicao: g.posicao })
    log('grupo', g.nome, `${g.itens.length} item(ns)`)

    for (const it of g.itens) {
      const imagemUrl = await subirImagem(rid, it.imagemOrigem, `${g.nome}-${it.nome}`)
      const item = await ins('itens_cardapio', {
        restaurante_id: rid, grupo_id: grupo.id, nome: it.nome, descricao: it.descricao,
        preco: it.preco, imagem_url: imagemUrl, status: 'disponivel',
        dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], tipo_item: it.tipoItem, tag: it.tag,
      })
      log('  item', it.nome, it.tipoItem, it.preco || '')

      for (const nomePreset of it.presets) {
        const p = preset[nomePreset]
        if (!p) continue
        const grupoComp = await ins('grupos_item_complementos', {
          item_id: item.id, preset_origem_id: p.id, nome: nomePreset,
          obrigatorio: false, min_escolhas: 0, max_escolhas: p.itens.length, posicao: 0, permite_quantidade: false,
        })
        for (const c of p.itens) {
          await ins('item_complementos', { item_id: item.id, grupo_id: grupoComp.id, nome: c.nome, preco: c.preco, posicao: c.posicao, preset_origem_id: p.id })
        }
        log('    preset', nomePreset)
      }

      for (const s of it.sabores ?? []) {
        const imgSabor = await subirImagem(rid, s.imagemOrigem, `sabor-${s.nome}`)
        const sabor = await ins('pizza_sabores', {
          item_id: item.id, nome: s.nome, descricao: s.descricao, imagem_url: imgSabor, status: 'disponivel', posicao: s.posicao,
        })
        for (const p of s.precos) {
          await ins('pizza_sabor_precos', { sabor_id: sabor.id, tamanho_padrao_id: idTamanho[p.tamanho], preco: p.preco })
        }
        log('    sabor', s.nome, s.precos.map((p) => `${p.tamanho} ${p.preco}`).join(' | '))
      }
    }
  }

  log('FIM —', criados, 'linhas', APPLY ? 'gravadas' : 'seriam gravadas')
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
```

- [ ] **Step 2: Rodar o dry-run**

Run: `node scripts/import-pizza-do-rosa/importar.mjs`
Expected: nenhum erro, e a última linha com o total. Confira na saída:
1. 5 tamanhos, com "máx 1/2/3/4/1".
2. 5 bordas a 19.
3. 5 presets com 33/22/19/3/3 complementos.
4. 15 grupos.
5. Sabores da "Pizza Salgada" com 4 preços cada; Brotinho e Promocional com 1 preço cada.

- [ ] **Step 3: Commit**

```bash
git add scripts/import-pizza-do-rosa/importar.mjs
git commit -m "chore(import): script de import do cardapio com dry-run"
```

---

### Task 11: Rodar o import em produção e validar

**Files:** nenhum arquivo alterado — esta task é execução e conferência.

**Interfaces:**
- Consumes: tudo das Tasks 1-10.
- Produces: cardápio da Pizza do Rosa no ar.

> **PARE AQUI E PEÇA AUTORIZAÇÃO.** Esta task escreve na conta de produção de um cliente real. Só siga com um "pode aplicar" explícito.

- [ ] **Step 1: Conferir que as tasks anteriores estão no ar**

Run: `git log --oneline -12`
Confirme os commits das Tasks 1-10.

Confirme no navegador que `app.menuzia.com.br/admin/cardapio` da loja `pizza-do-rosa` continua com **0 itens**. Se tiver item, pare — alguém mexeu e o plano precisa ser refeito.

- [ ] **Step 2: Aplicar**

Run: `node scripts/import-pizza-do-rosa/importar.mjs --apply`
Expected: mesma saída do dry-run, com prefixo `[apply]`, sem erro. Guarde a saída num arquivo:

```bash
node scripts/import-pizza-do-rosa/importar.mjs --apply 2>&1 | tee scripts/import-pizza-do-rosa/dados/log-import.txt
```

- [ ] **Step 3: Validar na vitrine**

Abra `https://app.menuzia.com.br/loja/pizza-do-rosa` e confirme, um a um:

1. As 15 categorias aparecem na ordem do spec.
2. "Pizzas Salgadas" abre com os 4 tamanhos (Pequena a Gigante) e **não** mostra Brotinho.
3. Grande mostra "Sabores — Escolha até 3"; escolher Calabresa (89) + Marguerita (109) mostra 99 no botão.
4. "Pizza Brotinho" mostra **só** o tamanho Brotinho, a R$ 49.
5. "Pizza Promocional" mostra **só** Gigante, a R$ 79, com a etiqueta de promoção.
6. Bordas aparecem nas 4 pizzas, a R$ 19.
7. Um hambúrguer abre com os 22 adicionais.
8. Todos os itens têm foto.

Feche um pedido de teste com pizza de 2 sabores e confirme no Painel de Pedidos que o card mostra `Calabresa / Marguerita` e o valor certo.

- [ ] **Step 4: Deixar o caminho de volta registrado**

Acrescente ao `scripts/import-pizza-do-rosa/README.md` a seção de reversão. Tudo que o script cria pendura em `grupos_cardapio` / `presets_complementos` / `tamanhos_padrao_pizza` / `bordas_pizza` do tenant, e as fotos ficam sob `<restauranteId>/import-expresso-2026-09/` no bucket `cardapio`. Deletar os grupos apaga itens, sabores, preços e complementos em cascata:

```sql
-- Reversão completa do import (rodar como service role, tenant pizza-do-rosa)
delete from grupos_cardapio        where restaurante_id = '<rid>';
delete from presets_complementos   where restaurante_id = '<rid>';
delete from bordas_pizza           where restaurante_id = '<rid>';
delete from tamanhos_padrao_pizza  where restaurante_id = '<rid>';
update restaurantes set pizza_calculo_preco = 'media' where id = '<rid>';
-- e apagar a pasta <rid>/import-expresso-2026-09/ do bucket `cardapio`
```

- [ ] **Step 5: Commit + push**

```bash
git add scripts/import-pizza-do-rosa/README.md scripts/import-pizza-do-rosa/dados/log-import.txt
git commit -m "chore(import): log e procedimento de reversao do import da Pizza do Rosa"
git push origin main
```

---

## Pontos que ficam conhecidos e não resolvidos

Registrar no handoff, não são bugs:

1. **Borda com preço único.** A origem cobra 15/17/19/22 por tamanho; foi importado 19 em todos. A loja cobra a mais em Pequena e a menos em Gigante. Resolver exige preço por tamanho em `bordas_pizza`.
2. **Adicional de pizza com preço único.** Mesmo caso: importado na coluna do Grande.
3. **Pizza Promocional aceita até 4 sabores** (o limite vem do tamanho Gigante), enquanto a origem limita a 2. Como todos os 15 sabores custam 79 e a regra é média, o preço não muda — só a regra de negócio é mais frouxa. Resolver exige limite de sabores por item, não só por tamanho.
4. **`promocao_preco` não vale pra item tipo pizza.** A Promocional foi marcada com `tag = 'promocao'`, que é visual. A aba "Promoções" da vitrine filtra por `promocao_preco` e não vai listá-la.
