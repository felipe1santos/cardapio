/**
 * Pedido esquecido: aberto há tempo demais para ainda estar acontecendo.
 *
 * Nada no sistema tira um pedido de "em rota" a não ser alguém da loja marcar
 * entregue. Quando ninguém marca, o pedido fica: a MENUZIA tinha o #95 em rota
 * desde julho. Isso não é um detalhe de tela — o pedido continua ocupando o
 * Kanban e a Logística, conta como não concluído na taxa de conclusão do
 * dashboard, e some do acompanhamento do cliente (a vitrine corta em 12h, ver
 * `pedidoEstaEmAndamento`).
 *
 * De propósito, NADA fecha nem cancela sozinho: pedido é dinheiro e histórico,
 * e um pedido que o sistema encerrasse por conta própria viraria uma venda
 * fantasma no caixa. O que falta é o aviso — a loja precisa VER que aquilo está
 * parado para resolver (entregue, não entregue ou cancelado).
 *
 * O corte é o mesmo da vitrine (12h) para as duas pontas concordarem: a partir
 * da hora em que o cliente deixa de acompanhar, a loja passa a ser cobrada.
 */

export const PEDIDO_PARADO_MS = 12 * 60 * 60 * 1000

/** Status que ainda esperam ação de alguém da loja. */
const EM_ANDAMENTO = new Set(['recebido', 'preparando', 'pronto', 'em_rota'])

export interface PedidoParavel {
  status: string
  criadoEm: string
}

export function pedidoParado(pedido: PedidoParavel, agora: number): boolean {
  if (!EM_ANDAMENTO.has(pedido.status)) return false
  const feito = Date.parse(pedido.criadoEm)
  // Data ilegível não vira alarme: o aviso existe para o que é claramente antigo.
  if (!Number.isFinite(feito)) return false
  return agora - feito >= PEDIDO_PARADO_MS
}

/**
 * Há quanto tempo, em texto curto para caber numa etiqueta de card.
 * Acima de um dia conta em dias: "parado há 63 h" não diz nada a ninguém.
 */
export function tempoParado(criadoEm: string, agora: number): string {
  const ms = agora - Date.parse(criadoEm)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const horas = Math.floor(ms / 3_600_000)
  if (horas < 24) return `${horas}h`
  const dias = Math.floor(horas / 24)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/** Aviso do topo da tela. Null = não há nada parado. */
export function avisoDePedidosParados(pedidos: PedidoParavel[], agora: number): string | null {
  const parados = pedidos.filter((p) => pedidoParado(p, agora))
  if (parados.length === 0) return null
  const qtd = parados.length
  return qtd === 1
    ? '1 pedido está aberto há mais de 12 horas. Marque como entregue, não entregue ou cancele — enquanto isso, ele conta como pendente na sua taxa de conclusão.'
    : `${qtd} pedidos estão abertos há mais de 12 horas. Marque cada um como entregue, não entregue ou cancele — enquanto isso, eles contam como pendentes na sua taxa de conclusão.`
}
