/**
 * Precificação / CMV (Fase 5) — regras puras, testadas em cmv-regras.test.ts. O banco (0142) faz a MESMA conta
 * para o custo guardado na venda; aqui ela serve à tela e à sugestão de preço.
 *
 * Dinheiro em CENTAVOS. Custo por unidade base (g, ml, un) tem fração de centavo: as contas intermediárias usam
 * o número inteiro (double), e só o RESULTADO exibido/gravado é arredondado para o centavo.
 */

export type UnidadeBase = 'g' | 'ml' | 'un'
export const UNIDADES_COMPRA = [
  { id: 'kg', rotulo: 'Quilo (kg)', base: 'g', fator: 1000, fixo: true },
  { id: 'g', rotulo: 'Grama (g)', base: 'g', fator: 1, fixo: true },
  { id: 'l', rotulo: 'Litro (L)', base: 'ml', fator: 1000, fixo: true },
  { id: 'ml', rotulo: 'Mililitro (ml)', base: 'ml', fator: 1, fixo: true },
  { id: 'un', rotulo: 'Unidade', base: 'un', fator: 1, fixo: true },
  { id: 'duzia', rotulo: 'Dúzia', base: 'un', fator: 12, fixo: true },
  { id: 'pacote', rotulo: 'Pacote', base: null, fator: null, fixo: false },
  { id: 'caixa', rotulo: 'Caixa', base: null, fator: null, fixo: false },
  { id: 'fardo', rotulo: 'Fardo', base: null, fator: null, fixo: false },
  { id: 'saco', rotulo: 'Saco', base: null, fator: null, fixo: false },
  { id: 'lata', rotulo: 'Lata', base: null, fator: null, fixo: false },
  { id: 'garrafa', rotulo: 'Garrafa', base: null, fator: null, fixo: false },
] as const
export type UnidadeCompra = (typeof UNIDADES_COMPRA)[number]['id']

/** Conversão automática: unidade de compra fixa → unidade base e fator (kg→1000 g, L→1000 ml, dúzia→12 un). */
export function conversaoPadrao(u: UnidadeCompra): { base: UnidadeBase; fator: number } | null {
  const d = UNIDADES_COMPRA.find((x) => x.id === u)
  return d && d.fixo ? { base: d.base as UnidadeBase, fator: d.fator as number } : null
}

export interface InsumoCusto {
  custoCompraCentavos: number
  quantidadeCompra: number
  basePorUnidade: number
  aproveitamentoPct: number
  preparado?: boolean
  rendimentoBase?: number | null
  /** Insumo preparado: componentes com o custo por unidade base de cada um. */
  componentes?: { quantidadeBase: number; custoPorBase: number }[]
}

/**
 * Custo por unidade base (centavos, com fração).
 *   comprado:  custo da compra ÷ (quantidade comprada × unidades base por unidade) ÷ aproveitamento
 *   preparado: Σ(quantidade × custo do componente) ÷ rendimento ÷ aproveitamento
 * Aproveitamento de 85% encarece: o custo real por grama é o custo ÷ 0,85.
 */
export function custoPorBase(i: InsumoCusto): number {
  const ap = (i.aproveitamentoPct || 100) / 100
  if (i.preparado) {
    const soma = (i.componentes ?? []).reduce((s, c) => s + c.quantidadeBase * c.custoPorBase, 0)
    return i.rendimentoBase ? soma / i.rendimentoBase / ap : 0
  }
  const base = i.quantidadeCompra * i.basePorUnidade
  return base > 0 ? i.custoCompraCentavos / base / ap : 0
}

/** Custo da ficha (centavos, com fração). */
export function custoFicha(componentes: { quantidadeBase: number; custoPorBase: number }[]): number {
  return componentes.reduce((s, c) => s + c.quantidadeBase * c.custoPorBase, 0)
}

/** Pizza com N sabores: fração 1/N de cada sabor (média do custo da ficha de cada um, naquele tamanho). */
export function custoPizza(custosSabores: number[]): number {
  return custosSabores.length ? custosSabores.reduce((s, c) => s + c, 0) / custosSabores.length : 0
}

export const centavos = (v: number) => Math.round(v)

/** Margem bruta em % sobre o preço de venda. Sem preço: null. */
export function margemPct(precoCentavos: number, custoCentavos: number): number | null {
  if (!precoCentavos) return null
  return ((precoCentavos - custoCentavos) / precoCentavos) * 100
}

export type Arredondamento = 'nenhum' | '90' | '99' | '00' | '50'
export const ARREDONDAMENTOS: { id: Arredondamento; rotulo: string }[] = [
  { id: '90', rotulo: 'Terminar em ,90' },
  { id: '99', rotulo: 'Terminar em ,99' },
  { id: '00', rotulo: 'Reais inteiros (,00)' },
  { id: '50', rotulo: 'Meio real (,00 ou ,50)' },
  { id: 'nenhum', rotulo: 'Sem arredondar' },
]

/** Arredonda PARA CIMA até o final escolhido (nunca baixa o preço abaixo do cálculo). */
export function arredondarPreco(c: number, modo: Arredondamento): number {
  const v = Math.ceil(c - 1e-9)
  switch (modo) {
    case 'nenhum': return v
    case '00': return Math.ceil(v / 100) * 100
    case '50': return Math.ceil(v / 50) * 50
    case '90':
    case '99': {
      const fim = modo === '90' ? 90 : 99
      const reais = Math.floor(v / 100)
      const cand = reais * 100 + fim
      return cand >= v ? cand : cand + 100
    }
  }
}

/**
 * Preço sugerido = custo ÷ (1 − margem-alvo − custos variáveis), arredondado para cima.
 * Ex.: custo R$ 7,48, margem 65%, cartão 5% → 7,48 ÷ 0,30 = R$ 24,94 → R$ 24,99 (final ,99) ou R$ 25,90 (final ,90).
 * Margem + variáveis ≥ 100% não tem preço possível: null.
 */
export function precoSugerido(custoCentavos: number, margemAlvoPct: number, variaveisPct: number, modo: Arredondamento): number | null {
  const denom = 1 - (margemAlvoPct + variaveisPct) / 100
  if (denom <= 0 || custoCentavos <= 0) return null
  return arredondarPreco(custoCentavos / denom, modo)
}

/**
 * Lê a quantidade da ficha de preparo (texto livre, ex.: "30 g", "120g", "1,5 kg", "200 ml", "1 un", "2")
 * e converte para a unidade base do insumo. Sem conseguir: null (a pessoa digita).
 */
export function lerQuantidadeTexto(texto: string, base: UnidadeBase): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ.]*)\s*$/.exec(texto ?? '')
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  const u = m[2].toLowerCase().replace(/\.$/, '')
  if (!u) return n
  if (base === 'g') { if (u === 'g' || u === 'gr' || u === 'gramas') return n; if (u === 'kg') return n * 1000 }
  if (base === 'ml') { if (u === 'ml') return n; if (u === 'l' || u === 'lt' || u === 'litro' || u === 'litros') return n * 1000 }
  if (base === 'un') { if (['un', 'und', 'unid', 'unidade', 'unidades', 'fatia', 'fatias'].includes(u)) return n }
  return null
}
