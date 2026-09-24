/**
 * A opção "massa padrão" das telas de pedido.
 *
 * Toda pizza já oferece uma escolha sem custo que significa "sem massa especial":
 * "Tradicional" no painel do garçom, "Padrão" no PDV, "Massa tradicional" na
 * vitrine. Quando a loja também cadastrou uma massa com esse nome e sem preço, a
 * tela mostrava duas opções iguais (visto na cantina-demo: "Tradicional" duas
 * vezes no garçom).
 *
 * Regra: massa da loja com nome equivalente ao padrão E sem preço é a mesma coisa
 * que a opção padrão — some da lista de escolha. O cadastro NÃO é apagado; a
 * linha continua na aba Tamanhos, marcada. Com preço (> 0) ela é outra oferta e
 * continua aparecendo.
 */

const NOMES_DO_PADRAO = new Set(['tradicional', 'padrao', 'massa tradicional', 'massa padrao', 'normal', 'massa normal', 'comum', 'massa comum'])

export function chaveMassa(nome: string): string {
  return nome.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/** O nome é o mesmo da opção padrão que toda pizza já tem? */
export function massaIgualAoPadrao(nome: string): boolean {
  return NOMES_DO_PADRAO.has(chaveMassa(nome))
}

/** Massas que entram na escolha do pedido, sem repetir a opção padrão. */
export function massasParaEscolha<T extends { nome: string; preco: number }>(massas: readonly T[]): T[] {
  return massas.filter((m) => !(massaIgualAoPadrao(m.nome) && !(m.preco > 0)))
}

export const ERRO_MASSA_IGUAL_AO_PADRAO =
  'Toda pizza já tem a opção de massa tradicional, sem custo. Cadastre aqui só as massas diferentes (ex.: Fina, Integral, Sem glúten).'
