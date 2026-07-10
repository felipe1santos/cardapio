# Bairro obrigatório + lista fechada de bairros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bairro vira campo obrigatório no checkout da vitrine; quando a loja cadastra bairros eles viram lista fechada (autocomplete estrito + bloqueio server-side); fora de área mostra contato da loja (telefone + WhatsApp).

**Architecture:** Extrair a decisão de frete para uma função pura `decidirFrete` em `lib/frete.ts` (testável sem mocks) + um wrapper de IO `resolverFrete` (busca dados no Supabase e geocodifica). Endpoint `/api/loja/[slug]/frete` e `criarPedido` passam a usar o mesmo resolver — `criarPedido` rejeita pedido de entrega não entregável. Na vitrine, o campo bairro vira autocomplete estrito quando a loja tem bairros e não tem raio.

**Tech Stack:** Next.js (App Router), Supabase (service_role no server, anon no client), Vitest, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-10-bairro-obrigatorio-lista-fechada-design.md`

## Global Constraints

- Semântica de entregabilidade (da spec): só bairros → lista fechada (sem match = bloqueia, padrão não entra); bairros+raio → bairro primeiro, senão geocode+raio, fora/geocode falhou = bloqueia; só raio → dentro/fora, geocode falhou = bloqueia; nada cadastrado → taxa padrão aceita tudo.
- Match de bairro: exato case-insensitive após `trim()`.
- Entrega grátis (`frete_gratis_acima`) zera a taxa DEPOIS da regra — não torna entregável o que não é.
- Identidade visual Menuzia: Inter, radius 3px, paleta do CLAUDE.md; danger `#EF4444`/`bg-danger #FEE2E2`; verde WhatsApp já usado no app `#16A34A`/`#15803D`.
- Textos de UI em pt-BR.
- Commits na main (Coolify deploya da main).

---

### Task 1: Função pura `decidirFrete` em `lib/frete.ts` (TDD)

**Files:**
- Modify: `lib/frete.ts` (adicionar tipos + função no fim do arquivo)
- Test: `lib/frete.test.ts` (criar)

**Interfaces:**
- Produces:
  ```ts
  export interface FreteDecisao {
    entregavel: boolean
    taxa: number
    fonte: 'bairro' | 'raio' | 'padrao'
    distanciaKm: number | null
    motivo?: string
  }
  export function decidirFrete(params: {
    bairroCliente: string
    bairros: { bairro: string; taxa: number }[]
    raios: { ateKm: number; taxa: number }[]
    taxaPadrao: number
    distanciaKm: number | null // null = geocode falhou ou não tentado
  }): FreteDecisao
  ```

- [ ] **Step 1: Write the failing tests**

Criar `lib/frete.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decidirFrete } from './frete'

const bairros = [
  { bairro: 'Jardim Colorado', taxa: 5 },
  { bairro: 'Jardim Marilandia', taxa: 7 },
]
const raios = [
  { ateKm: 3, taxa: 4 },
  { ateKm: 6, taxa: 8 },
]

describe('decidirFrete', () => {
  it('bairro cadastrado resolve com a taxa do bairro (case-insensitive, com espaços)', () => {
    const r = decidirFrete({ bairroCliente: '  jardim colorado ', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r).toEqual({ entregavel: true, taxa: 5, fonte: 'bairro', distanciaKm: null })
  })

  it('lista fechada (só bairros): bairro fora da lista bloqueia — não cai na taxa padrão', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
    expect(r.taxa).toBe(0)
    expect(r.fonte).toBe('bairro')
    expect(r.motivo).toBeTruthy()
  })

  it('lista fechada (só bairros): bairro vazio bloqueia', () => {
    const r = decidirFrete({ bairroCliente: '', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
  })

  it('bairros + raio: sem match de bairro, dentro da faixa → taxa da faixa', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros, raios, taxaPadrao: 10, distanciaKm: 4.26 })
    expect(r).toEqual({ entregavel: true, taxa: 8, fonte: 'raio', distanciaKm: 4.3 })
  })

  it('bairros + raio: match de bairro tem prioridade sobre a distância', () => {
    const r = decidirFrete({ bairroCliente: 'Jardim Marilandia', bairros, raios, taxaPadrao: 10, distanciaKm: 99 })
    expect(r).toEqual({ entregavel: true, taxa: 7, fonte: 'bairro', distanciaKm: null })
  })

  it('raio: fora de todas as faixas bloqueia com motivo de distância', () => {
    const r = decidirFrete({ bairroCliente: '', bairros: [], raios, taxaPadrao: 10, distanciaKm: 9.14 })
    expect(r.entregavel).toBe(false)
    expect(r.fonte).toBe('raio')
    expect(r.distanciaKm).toBe(9.1)
    expect(r.motivo).toContain('9.1')
  })

  it('raio configurado mas geocode falhou (distanciaKm null) bloqueia', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros: [], raios, taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
    expect(r.fonte).toBe('raio')
    expect(r.motivo).toBeTruthy()
  })

  it('nada cadastrado: taxa padrão, aceita qualquer endereço', () => {
    const r = decidirFrete({ bairroCliente: 'Qualquer', bairros: [], raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r).toEqual({ entregavel: true, taxa: 10, fonte: 'padrao', distanciaKm: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/frete.test.ts`
Expected: FAIL — `decidirFrete` não é exportada de `./frete`.

- [ ] **Step 3: Implement `decidirFrete`**

Adicionar ao FIM de `lib/frete.ts`:

```ts
// ── Decisão de entregabilidade ────────────────────────────────────────────────
// Regra (ver docs/superpowers/specs/2026-07-10-bairro-obrigatorio-lista-fechada-design.md):
// bairro cadastrado resolve primeiro; depois faixas de raio pela distância; a taxa
// padrão só vale quando a loja não restringiu área (sem bairros e sem raio).

export interface FreteDecisao {
  entregavel: boolean
  taxa: number
  fonte: 'bairro' | 'raio' | 'padrao'
  distanciaKm: number | null
  motivo?: string
}

export function decidirFrete(params: {
  bairroCliente: string
  bairros: { bairro: string; taxa: number }[]
  raios: { ateKm: number; taxa: number }[]
  taxaPadrao: number
  /** Distância loja→cliente em km; null quando o geocode falhou ou não foi tentado. */
  distanciaKm: number | null
}): FreteDecisao {
  const alvo = params.bairroCliente.trim().toLowerCase()
  if (alvo) {
    const match = params.bairros.find((b) => b.bairro.trim().toLowerCase() === alvo)
    if (match) return { entregavel: true, taxa: match.taxa, fonte: 'bairro', distanciaKm: null }
  }

  if (params.raios.length > 0) {
    if (params.distanciaKm != null) {
      const dist = Math.round(params.distanciaKm * 10) / 10
      const faixa = params.raios.find((r) => params.distanciaKm! <= r.ateKm)
      if (faixa) return { entregavel: true, taxa: faixa.taxa, fonte: 'raio', distanciaKm: dist }
      const maxKm = params.raios[params.raios.length - 1].ateKm
      return {
        entregavel: false,
        taxa: 0,
        fonte: 'raio',
        distanciaKm: dist,
        motivo: `Esse endereço está a ${dist} km — fora da área de entrega (até ${maxKm} km).`,
      }
    }
    return {
      entregavel: false,
      taxa: 0,
      fonte: 'raio',
      distanciaKm: null,
      motivo: 'Não conseguimos localizar esse endereço. Confira o CEP e os dados digitados.',
    }
  }

  if (params.bairros.length > 0) {
    return { entregavel: false, taxa: 0, fonte: 'bairro', distanciaKm: null, motivo: 'A loja não entrega nesse bairro.' }
  }

  return { entregavel: true, taxa: params.taxaPadrao, fonte: 'padrao', distanciaKm: null }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/frete.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/frete.ts lib/frete.test.ts
git commit -m "feat(frete): decisao pura de entregabilidade com lista fechada de bairros"
```

---

### Task 2: Wrapper de IO `resolverFrete` + endpoint `/frete` usa a nova regra

**Files:**
- Modify: `lib/frete.ts` (adicionar `resolverFrete` no fim)
- Modify: `app/api/loja/[slug]/frete/route.ts` (reescrever usando `resolverFrete`)

**Interfaces:**
- Consumes: `decidirFrete`, `FreteDecisao`, `geocodeEndereco`, `haversineKm`, `Coord` (Task 1 / existentes em `lib/frete.ts`).
- Produces:
  ```ts
  export interface EnderecoFrete { cep?: string; rua?: string; numero?: string; bairro?: string; cidade?: string }
  export async function resolverFrete(
    admin: SupabaseClient,
    restauranteId: string,
    endereco: EnderecoFrete,
    mapsKey?: string
  ): Promise<FreteDecisao>
  ```
  O endpoint continua respondendo o mesmo shape `FreteResposta` (agora = `FreteDecisao`), então o client existente não quebra.

- [ ] **Step 1: Adicionar `resolverFrete` em `lib/frete.ts`**

No topo do arquivo, adicionar o import de tipo:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
```

No fim do arquivo (depois de `decidirFrete`):

```ts
export interface EnderecoFrete {
  cep?: string
  rua?: string
  numero?: string
  bairro?: string
  cidade?: string
}

/**
 * Resolve o frete de um endereço buscando a configuração da loja no banco.
 * Geocodifica só quando necessário (bairro não resolveu e existem faixas de raio)
 * e cacheia as coordenadas da loja em restaurantes.latitude/longitude.
 * Usado pelo endpoint /api/loja/[slug]/frete e por criarPedido (server-authoritative).
 */
export async function resolverFrete(
  admin: SupabaseClient,
  restauranteId: string,
  endereco: EnderecoFrete,
  mapsKey?: string
): Promise<FreteDecisao> {
  const [{ data: loja }, { data: bairrosDb }, { data: raiosDb }] = await Promise.all([
    admin
      .from('restaurantes')
      .select('taxa_entrega_padrao, latitude, longitude, cep, endereco')
      .eq('id', restauranteId)
      .maybeSingle(),
    admin.from('taxas_entrega_bairro').select('bairro, taxa').eq('restaurante_id', restauranteId),
    admin.from('taxas_entrega_raio').select('ate_km, taxa').eq('restaurante_id', restauranteId).order('ate_km', { ascending: true }),
  ])
  const bairros = (bairrosDb ?? []).map((b) => ({ bairro: String(b.bairro), taxa: Number(b.taxa) }))
  const raios = (raiosDb ?? []).map((r) => ({ ateKm: Number(r.ate_km), taxa: Number(r.taxa) }))
  const taxaPadrao = loja ? Number(loja.taxa_entrega_padrao) || 0 : 0

  const alvo = (endereco.bairro ?? '').trim().toLowerCase()
  const bairroResolve = alvo !== '' && bairros.some((b) => b.bairro.trim().toLowerCase() === alvo)

  let distanciaKm: number | null = null
  if (!bairroResolve && raios.length > 0 && loja) {
    let lojaCoord: Coord | null =
      loja.latitude != null && loja.longitude != null
        ? { lat: Number(loja.latitude), lng: Number(loja.longitude) }
        : null
    if (!lojaCoord) {
      lojaCoord = await geocodeEndereco({ cep: loja.cep ?? undefined, endereco: loja.endereco ?? undefined }, mapsKey)
      if (lojaCoord) {
        await admin.from('restaurantes').update({ latitude: lojaCoord.lat, longitude: lojaCoord.lng }).eq('id', restauranteId)
      }
    }
    const enderecoCliente = [endereco.rua, endereco.numero, endereco.bairro, endereco.cidade]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ')
    const clienteCoord = await geocodeEndereco({ cep: endereco.cep, endereco: enderecoCliente || undefined }, mapsKey)
    if (lojaCoord && clienteCoord) distanciaKm = haversineKm(lojaCoord, clienteCoord)
  }

  return decidirFrete({ bairroCliente: endereco.bairro ?? '', bairros, raios, taxaPadrao, distanciaKm })
}
```

- [ ] **Step 2: Reescrever `app/api/loja/[slug]/frete/route.ts`**

Conteúdo completo do arquivo:

```ts
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverFrete, type EnderecoFrete, type FreteDecisao } from '@/lib/frete'

export type FreteResposta = FreteDecisao

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Calcula o frete para um endereço de cliente. Regra em lib/frete.ts (decidirFrete):
 * bairro cadastrado → faixa de raio → taxa padrão (esta só quando a loja não
 * restringiu área). Bairro fora da lista fechada ou endereço fora do raio
 * retornam entregavel: false.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let body: EnderecoFrete
  try {
    body = (await request.json()) as EnderecoFrete
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  const { data: loja, error: lojaErr } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (lojaErr) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  const resultado = await resolverFrete(admin, loja.id, body, MAPS_KEY)
  return NextResponse.json<FreteResposta>(resultado)
}
```

Nota: `FreteBody` some (substituído por `EnderecoFrete`). Antes de apagar, rodar `grep -r "FreteBody\|FreteResposta" --include="*.ts*"` — se algo importar `FreteResposta` do route, o alias exportado acima mantém compatível.

- [ ] **Step 3: Typecheck + testes**

Run: `npx tsc --noEmit && npx vitest run lib/frete.test.ts`
Expected: sem erros, 8 testes passando.

- [ ] **Step 4: Commit**

```bash
git add lib/frete.ts "app/api/loja/[slug]/frete/route.ts"
git commit -m "feat(frete): endpoint usa resolver compartilhado e bloqueia fora de area"
```

---

### Task 3: `criarPedido` rejeita pedido não entregável

**Files:**
- Modify: `lib/queries/pedidos.ts` — remover `calcularTaxaEntrega` (linhas ~782-833) e trocar o cálculo em `criarPedido` (linha ~979)

**Interfaces:**
- Consumes: `resolverFrete` de `@/lib/frete` (Task 2).
- Produces: `criarPedido` lança `Error` com mensagem amigável quando `tipo === 'entrega'` e o endereço não é entregável. O endpoint `app/api/loja/[slug]/pedido/route.ts` já converte `Error` em `{ error: message }` com status 400 — nenhuma mudança lá.

- [ ] **Step 1: Remover `calcularTaxaEntrega` e usar `resolverFrete`**

Em `lib/queries/pedidos.ts`:

1. Ajustar o import de `@/lib/frete` (hoje importa `geocodeEndereco, haversineKm, type Coord`) para:

```ts
import { resolverFrete } from '@/lib/frete'
```

(Se `geocodeEndereco`/`haversineKm`/`Coord` não forem usados em mais nenhum lugar do arquivo — conferir com grep — removê-los do import.)

2. Apagar a função `calcularTaxaEntrega` inteira (comentário JSDoc incluído, ~linhas 782-833). Único caller é `criarPedido` (verificado por grep em 2026-07-10).

3. Em `criarPedido`, substituir:

```ts
  const subtotal = linhas.reduce((s, l) => s + l.preco_unitario * l.quantidade, 0)
  let taxaEntrega = input.tipo === 'entrega' ? await calcularTaxaEntrega(admin, restauranteId, input.endereco) : 0
```

por:

```ts
  const subtotal = linhas.reduce((s, l) => s + l.preco_unitario * l.quantidade, 0)
  // Taxa server-authoritative: mesma regra do endpoint /frete. Endereço fora da
  // área (bairro fora da lista fechada ou fora do raio) rejeita o pedido.
  let taxaEntrega = 0
  if (input.tipo === 'entrega') {
    const frete = await resolverFrete(admin, restauranteId, input.endereco, process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
    if (!frete.entregavel) throw new Error(frete.motivo || 'A loja não entrega nesse endereço. Entre em contato com a loja.')
    taxaEntrega = frete.taxa
  }
```

4. Atualizar o comentário do campo `taxaEntrega` em `NovoPedidoInput` (linha ~852) para: `/** Apenas informativo — a taxa real é recalculada no servidor (resolverFrete). */`

- [ ] **Step 2: Typecheck + testes**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc limpo; suíte passa (exceção conhecida pré-existente: `app/page.test.tsx` espera heading mas a página é redirect — se falhar, ignorar, é anterior a este trabalho).

- [ ] **Step 3: Commit**

```bash
git add lib/queries/pedidos.ts
git commit -m "feat(pedido): rejeita pedido de entrega fora da area atendida"
```

---

### Task 4: Vitrine — bairro obrigatório, autocomplete estrito, card de contato

**Files:**
- Modify: `lib/queries/cardapio.ts` (adicionar `lojaTemRaioVitrine` após `listarBairrosVitrine`, ~linha 719)
- Modify: `app/loja/[slug]/page.tsx` (vários pontos, indicados abaixo)

**Interfaces:**
- Consumes: `bairros` state (já existe), `restaurante.telefone`, `numeroWaLoja()` (page.tsx:977), endpoint `/frete` (Task 2).
- Produces:
  ```ts
  export async function lojaTemRaioVitrine(supabase: SupabaseClient, restauranteId: string): Promise<boolean>
  ```
  (RLS de `taxas_entrega_raio` permite select anon — migration 0028.)

- [ ] **Step 1: `lojaTemRaioVitrine` em `lib/queries/cardapio.ts`**

Logo após `listarBairrosVitrine` (~linha 719):

```ts
/** True se a loja tem faixas de entrega por raio — muda o modo do campo bairro no checkout. */
export async function lojaTemRaioVitrine(supabase: SupabaseClient, restauranteId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('taxas_entrega_raio')
    .select('id', { count: 'exact', head: true })
    .eq('restaurante_id', restauranteId)
  if (error) throw error
  return (count ?? 0) > 0
}
```

- [ ] **Step 2: Carregar `temRaio` na vitrine**

Em `app/loja/[slug]/page.tsx`:

1. Adicionar `lojaTemRaioVitrine` ao import de `@/lib/queries/cardapio` (bloco de import ~linha 7).
2. Estado, junto de `bairros` (~linha 274):

```ts
  const [temRaio, setTemRaio] = useState(false)
```

3. No `Promise.all` do load (~linha 294), adicionar a chamada e o set:

```ts
        const [cardapio, taxasBairro, temRaioLoja, bumps, tamanhosPizzaData, bordasData, massasData] = await Promise.all([
          listarCardapioPublico(supabase, loja.id),
          listarBairrosVitrine(supabase, loja.id),
          lojaTemRaioVitrine(supabase, loja.id),
          listarOrderBumpsPublico(supabase, loja.id, loja.orderBumpMax),
          listarTamanhosPadraoPizza(supabase, loja.id),
          listarBordasPizza(supabase, loja.id),
          listarMassasPizza(supabase, loja.id),
        ])
```

e, junto dos outros sets: `setTemRaio(temRaioLoja)`.

4. Derivados, logo após a declaração de `feeFallback`/perto de `entregavel` (~linha 389):

```ts
  // Lista fechada: a loja cadastrou bairros e não usa raio — só entrega nos bairros da lista.
  const listaFechada = bairros.length > 0 && !temRaio
  const bairroValido =
    !listaFechada || bairros.some((b) => b.bairro.trim().toLowerCase() === endereco.bairro.trim().toLowerCase())
```

5. Ajustar `feeFallback` (~linha 389) — sem match em lista fechada não pode mostrar taxa padrão:

```ts
  const feeFallback = useMemo(() => {
    const alvo = endereco.bairro.trim().toLowerCase()
    const match = bairros.find((b) => b.bairro.trim().toLowerCase() === alvo)
    if (match) return match.taxa
    if (bairros.length > 0 && !temRaio) return 0 // lista fechada: fora da lista não há frete
    return restaurante?.taxaEntregaPadrao ?? 0
  }, [restaurante, bairros, temRaio, endereco.bairro])
```

- [ ] **Step 3: Guard do checkout (bairro obrigatório + lista fechada)**

Em `checkoutNext()` (~linha 1044), substituir o primeiro guard por:

```ts
    if (checkoutStep === 2 && (!cliente.nome.trim() || !endereco.rua.trim() || !endereco.numero.trim() || !endereco.bairro.trim())) {
      setCheckoutError('Preencha nome, rua, número e bairro para continuar.')
      return
    }
    if (checkoutStep === 2 && listaFechada && !bairroValido) {
      setCheckoutError('Escolha um bairro da lista de bairros atendidos pela loja.')
      return
    }
```

(O guard existente de `!entregavel` logo abaixo permanece.)

- [ ] **Step 4: Autofill do ViaCEP respeita a lista fechada**

Em `autofillCep` (~linha 410), trocar o `setEndereco` por:

```ts
      if (!data.erro) {
        setEndereco((a) => {
          let bairroNovo = data.bairro || a.bairro
          if (listaFechada && bairroNovo) {
            const m = bairros.find((b) => b.bairro.trim().toLowerCase() === String(bairroNovo).trim().toLowerCase())
            bairroNovo = m ? m.bairro : '' // sem match: cliente escolhe da lista
          }
          return { ...a, rua: data.logradouro || a.rua, bairro: bairroNovo }
        })
        setCidadeCliente(data.localidade || '')
      }
```

- [ ] **Step 5: Componente `BairroAutocomplete` (autocomplete estrito)**

Adicionar componente module-level em `app/loja/[slug]/page.tsx`, antes de `export default function StorefrontPage()` (~linha 262, junto dos outros componentes locais):

```tsx
/**
 * Autocomplete estrito de bairro (modo lista fechada): filtra os bairros atendidos
 * conforme o cliente digita e só um valor da lista vale como bairro válido.
 */
function BairroAutocomplete({ value, onChange, opcoes }: { value: string; onChange: (v: string) => void; opcoes: string[] }) {
  const [aberto, setAberto] = useState(false)
  const filtro = value.trim().toLowerCase()
  const sugestoes = filtro ? opcoes.filter((b) => b.toLowerCase().includes(filtro)) : opcoes
  const exato = opcoes.some((b) => b.toLowerCase() === filtro)
  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setAberto(true) }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        placeholder="Digite e escolha o bairro"
        className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]"
      />
      {aberto && !exato && sugestoes.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[200px] overflow-y-auto rounded-md border border-border bg-white shadow-lg">
          {sugestoes.map((b) => (
            <button
              key={b}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(b); setAberto(false) }}
              className="block w-full px-3 py-2.5 text-left text-[14px] hover:bg-[#F3F4F6]"
            >
              {b}
            </button>
          ))}
        </div>
      )}
      {value.trim() !== '' && !exato && (
        <p className="mt-1.5 text-[12px] font-medium text-danger">Escolha um bairro da lista — entregamos só nos bairros atendidos.</p>
      )}
    </div>
  )
}
```

Detalhe: `onMouseDown={(e) => e.preventDefault()}` impede o blur do input de fechar o dropdown antes do click registrar.

- [ ] **Step 6: Campo bairro no step 2 usa o componente no modo lista fechada**

Substituir o bloco do campo Bairro (~linhas 2141-2149) por:

```tsx
                  <div className="flex-1">
                    <label className="mb-1.5 block text-[13px] font-semibold text-text-main">Bairro *</label>
                    {listaFechada ? (
                      <BairroAutocomplete
                        value={endereco.bairro}
                        onChange={(v) => setEndereco((a) => ({ ...a, bairro: v }))}
                        opcoes={bairros.map((b) => b.bairro)}
                      />
                    ) : (
                      <>
                        <input value={endereco.bairro} onChange={(e) => setEndereco((a) => ({ ...a, bairro: e.target.value }))} placeholder="Bairro" list="bairros-loja"
                          className="w-full rounded-md border border-border p-3 font-sans text-[15px] outline-none focus:border-[var(--tema-primaria)]" />
                        {/* Sugestões: bairros que a loja atende (cadastrados no painel Entrega) */}
                        <datalist id="bairros-loja">
                          {bairros.map((b) => <option key={b.bairro} value={b.bairro} />)}
                        </datalist>
                      </>
                    )}
                  </div>
```

- [ ] **Step 7: Card "fora de área" com telefone + WhatsApp**

1. Adicionar `Phone` ao import do lucide (linha 5):

```ts
import { UtensilsCrossed, CreditCard, Banknote, Pencil, Truck, MapPin, Phone } from 'lucide-react'
```

2. Substituir o bloco de fora de área (~linhas 2166-2170) por:

```tsx
                ) : (
                  <div className="mt-3 rounded border border-danger bg-danger/10 px-3 py-3">
                    <p className="text-[13px] font-semibold text-danger">{freteCalc?.motivo || 'A loja não entrega neste endereço.'}</p>
                    <p className="mt-1 text-[12px] text-text-subtle">Entre em contato com a loja para combinar a entrega.</p>
                    {restaurante?.telefone?.trim() && (
                      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-main">
                          <Phone className="h-4 w-4 flex-shrink-0" strokeWidth={2} />
                          {restaurante.telefone}
                        </span>
                        {numeroWaLoja() && (
                          <a
                            href={`https://wa.me/${numeroWaLoja()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1.5 rounded bg-[#16A34A] px-3 py-2 text-[12px] font-bold text-white transition-colors hover:bg-[#15803D]"
                          >
                            Falar com a loja no WhatsApp
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )
```

- [ ] **Step 8: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: ambos limpos.

- [ ] **Step 9: Commit**

```bash
git add lib/queries/cardapio.ts "app/loja/[slug]/page.tsx"
git commit -m "feat(vitrine): bairro obrigatorio com lista fechada e contato quando fora de area"
```

---

### Task 5: Verificação end-to-end

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: testes de frete passam (falha pré-existente de `app/page.test.tsx` é conhecida e não relacionada); tsc e build limpos.

- [ ] **Step 2: Smoke no navegador (loja demo `menuzia`, `npm run dev`)**

Cenários, na loja demo (tem bairros cadastrados; conferir se tem raio — ajustar em Ajustes › Entrega conforme o cenário):

1. **Lista fechada** (bairros, sem raio): no checkout step 2, digitar prefixo de bairro (ex. "Ja") → dropdown filtra os bairros cadastrados; escolher um → frete mostra a taxa do bairro; digitar bairro inexistente → hint vermelho + avançar bloqueado com "Escolha um bairro da lista"; card fora de área mostra telefone + botão WhatsApp após o debounce do servidor.
2. **Bairro vazio** → avançar bloqueado com "Preencha nome, rua, número e bairro".
3. **Bairros + raio** (cadastrar uma faixa de raio temporária): bairro fora da lista mas CEP dentro do raio → entrega com taxa da faixa; CEP longe → bloqueado com motivo de distância + contato.
4. **Pedido completo** com bairro da lista → criar pedido e conferir `taxa_entrega` do pedido no banco/painel = taxa do bairro.
5. **Server-side**: `curl POST /api/loja/menuzia/pedido` com bairro fora da lista (payload de entrega válido) → resposta 400 com mensagem de área não atendida.

- [ ] **Step 3: Impressão**

Abrir preview de impressão do pedido de teste (painel de pedidos) e conferir: taxa de entrega impressa = taxa do bairro; bairro impresso no bloco do cliente. (Sem mudança de código no printer-agent — só confirmação.)

- [ ] **Step 4: Push**

```bash
git push origin main
```
