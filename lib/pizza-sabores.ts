/**
 * Quais sabores uma pizza oferece num tamanho, e por quanto (2026-10-01). UMA regra para a
 * vitrine, o PDV, o painel do garçom, o QR da mesa e o servidor (antes eram cópias de
 * "sabor ativo com preço > 0 no tamanho").
 *
 * - Pizza precificada POR SABOR (algum sabor tem preço em algum tamanho): valem os sabores
 *   ativos com preço > 0 neste tamanho — a regra de sempre.
 * - Pizza SEM nenhum preço por sabor (ex.: "Pizza Brotinho" com preço só no item): os sabores
 *   ativos valem com o preço do ITEM. Antes ficavam todos de fora e o grupo obrigatório "Sabor"
 *   travava a venda ("Nenhum sabor disponível neste tamanho").
 * - Nenhum sabor ativo (ex.: "Pizza Baiana" cadastrada sem sabores): o sabor deixa de ser
 *   obrigatório — a pizza sai pelo preço do item, e a tela avisa "Este tamanho não tem sabores
 *   cadastrados" para a loja corrigir o cadastro.
 */
import { precoDoSaborNoTamanho, type PrecosDoSabor } from './pizza-tamanhos'

export interface SaborComPrecos { nome: string; status: string; precos: PrecosDoSabor }

const temPreco = (precos: PrecosDoSabor) => (Array.isArray(precos) ? precos.some((p) => p.preco > 0) : Object.values(precos).some((p) => p > 0))

/** Algum sabor desta pizza tem preço em algum tamanho? */
export function pizzaTemPrecoPorSabor(sabores: readonly SaborComPrecos[]): boolean {
  return sabores.some((s) => temPreco(s.precos))
}

/**
 * Sabores vendáveis num tamanho, com o preço de cada um. `itemPreco` é o preço do item (usado só
 * quando a pizza não tem preço por sabor). Sem `itemPreco` (chamada antiga), nada de fallback.
 */
export function saboresDoTamanho<T extends SaborComPrecos>(sabores: readonly T[], tamanhoId: string | null | undefined, itemPreco?: number | null): { sabor: T; preco: number }[] {
  if (!tamanhoId) return []
  const ativos = sabores.filter((s) => s.status === 'disponivel')
  if (pizzaTemPrecoPorSabor(sabores)) {
    return ativos
      .map((sabor) => ({ sabor, preco: precoDoSaborNoTamanho(sabor.precos, tamanhoId) }))
      .filter((x) => x.preco > 0)
  }
  if (itemPreco === undefined || itemPreco === null) return []
  return ativos.map((sabor) => ({ sabor, preco: Number(itemPreco) || 0 }))
}

/** Pizza sem nenhum sabor ativo: o grupo "Sabor" não é obrigatório (nunca trava a venda). */
export function pizzaSemSabores(sabores: readonly SaborComPrecos[]): boolean {
  return !sabores.some((s) => s.status === 'disponivel')
}

const chave = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()

/**
 * O próprio produto já é um sabor ("Pizza Calabresa" com o sabor "Calabresa"): esse sabor vem
 * marcado por padrão. Casa palavra inteira, o nome mais longo primeiro ("Frango com Catupiry"
 * antes de "Frango").
 */
export function saborDoProprioItem(itemNome: string, nomes: readonly string[]): string | null {
  const item = ` ${chave(itemNome).replace(/[^a-z0-9]+/g, ' ')} `
  const ordenados = [...nomes].sort((a, b) => b.length - a.length)
  for (const n of ordenados) {
    const k = chave(n).replace(/[^a-z0-9]+/g, ' ').trim()
    if (k && item.includes(` ${k} `)) return n
  }
  return null
}
