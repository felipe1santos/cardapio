/**
 * "Troco para quanto?" — e por que o valor precisa cobrir o pedido.
 *
 * O checkout aceitava qualquer número. Em produção havia três pedidos com troco
 * menor que a conta: #76 de R$ 67,00 com "troco para R$ 50,00". Na porta do
 * cliente isso vira discussão, e no fechamento de caixa vira número negativo —
 * `calcularCaixaEntregadorHoje` soma `troco ?? total` como recebido e subtrai o
 * total como "a devolver", então um troco menor que a conta faz o entregador
 * aparecer devolvendo dinheiro que ele nunca pegou.
 *
 * Vazio continua valendo: é o cliente dizendo "não precisa de troco".
 */

export const TROCO_MENOR_QUE_TOTAL = 'O valor do troco precisa ser igual ou maior que o total do pedido.'

/**
 * `null` = pode seguir. String = o que dizer ao cliente.
 *
 * `trocoPara` chega como o cliente digitou: `null`/`0` quando ele não pediu
 * troco. Só há erro quando ele pediu um valor E esse valor não cobre a conta.
 */
export function erroDoTroco(total: number, trocoPara: number | null | undefined): string | null {
  if (trocoPara === null || trocoPara === undefined) return null
  if (!Number.isFinite(trocoPara) || trocoPara <= 0) return null
  // Centavo de arredondamento não é erro de troco.
  if (trocoPara + 0.005 >= total) return null
  return TROCO_MENOR_QUE_TOTAL
}

/** Quanto o entregador precisa levar de troco. Zero quando o cliente não pediu. */
export function trocoALevar(total: number, trocoPara: number | null | undefined): number {
  if (trocoPara === null || trocoPara === undefined) return 0
  if (!Number.isFinite(trocoPara) || trocoPara <= total) return 0
  return Math.round((trocoPara - total) * 100) / 100
}
