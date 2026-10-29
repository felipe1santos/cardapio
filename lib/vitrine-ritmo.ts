/**
 * De quanto em quanto tempo a vitrine consulta "meus pedidos" (29/10, sistema mais leve).
 * Antes consultava a cada 30 s mesmo sem nenhum pedido. Agora `null` = sem relógio nenhum.
 *
 * `temPedidoAtivo` vem do ÚLTIMO status lido: o pedido só deixa de ser ativo depois que a leitura
 * trouxe o status final ("Entregue"/"Cancelado") e a tela o mostrou — nunca para antes disso.
 */
export function ritmoPedidos(e: {
  abaPedidosAberta: boolean
  detalheAberto: boolean
  temPedidoAtivo: boolean
  entregaEmCurso: boolean
}): number | null {
  if (e.abaPedidosAberta || e.detalheAberto) return 8000
  if (e.entregaEmCurso) return 15000
  if (e.temPedidoAtivo) return 30000
  return null
}

/** Sem relógio (ritmo null), a vitrine ainda lê uma vez ao voltar à aba — só com cliente logado. */
export function leAoVoltar(temSessao: boolean): boolean {
  return temSessao
}
