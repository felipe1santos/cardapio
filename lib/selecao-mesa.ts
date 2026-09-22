import type { OpcaoDaLinha } from '@/lib/selecao-preco'

/**
 * Juntar toques repetidos na mesma linha da seleção da mesa (cardápio do QR).
 *
 * A seleção é a lista que o cliente mostra ao garçom. Tocar duas vezes na mesma
 * Coca criava duas linhas de "1× Coca", e a lista de uma mesa de seis pessoas
 * virava uma coluna de linhas iguais que ninguém consegue conferir em voz alta.
 * Somar na linha existente é o que o cliente espera de qualquer sacola — e é o
 * que o lançamento do garçom já fazia (`adicionarAoLancamento`, em
 * lib/garcom-catalogo.ts). Aqui vale a mesma regra, para os dois lados da mesa
 * falarem a mesma língua.
 *
 * Só junta o que é REALMENTE igual: mesmo item, mesmas opções e mesma
 * observação. "Sem cebola" é outro prato para a cozinha, então é outra linha.
 */

/** Teto de uma linha. Acima disto é erro de dedo, não pedido. */
export const SELECAO_QTD_MAX = 99

export interface LinhaDaSelecao {
  chave: string
  itemId: string
  quantidade: number
  observacao: string
  opcoes: OpcaoDaLinha[]
}

/**
 * Assinatura do que faz duas linhas serem a mesma coisa.
 *
 * As opções entram ordenadas: escolher "bacon, cheddar" e "cheddar, bacon" dá o
 * mesmo prato, e o cliente não entende por que viraram duas linhas.
 */
export function assinaturaDaLinha(l: Pick<LinhaDaSelecao, 'itemId' | 'observacao' | 'opcoes'>): string {
  const opcoes = l.opcoes
    .map((o) => `${o.grupo}=${o.escolha}`)
    .sort()
    .join('|')
  return [l.itemId, opcoes, l.observacao.trim().toLowerCase()].join('§')
}

/**
 * Adiciona a linha nova à seleção, somando na linha igual quando ela já existe.
 *
 * A linha que absorve mantém a própria `chave`: ela é a identidade da linha na
 * tela (quantidade, remover) e trocá-la faria o React remontar a linha — piscada
 * à toa bem no momento em que o cliente acabou de tocar em "adicionar".
 */
export function adicionarNaSelecao<T extends LinhaDaSelecao>(atual: T[], nova: T): T[] {
  const assinatura = assinaturaDaLinha(nova)
  const iguais = atual.findIndex((l) => assinaturaDaLinha(l) === assinatura)
  if (iguais === -1) return [...atual, nova]
  return atual.map((l, i) =>
    i === iguais ? { ...l, quantidade: Math.min(SELECAO_QTD_MAX, l.quantidade + nova.quantidade) } : l,
  )
}
