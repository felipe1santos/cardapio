/**
 * Como o CLIENTE vê a etapa do pedido — a mesma regra na vitrine (selo do pedido) e no
 * robô do WhatsApp (“status do pedido”).
 *
 * Na loja sem entregador (0079) ninguém confirma a entrega: o pedido concluído aparece
 * como “Saiu para entrega”, não como “Entregue”.
 */
export const ROTULO_STATUS_PEDIDO: Record<string, string> = {
  recebido: 'Recebido',
  preparando: 'Preparando',
  pronto: 'Pronto',
  em_rota: 'Saiu para entrega',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
}

export function rotuloStatusPedidoCliente(p: { status: string; saidaSemConfirmacao?: boolean }): string {
  if (p.saidaSemConfirmacao && p.status === 'entregue') return 'Saiu para entrega'
  return ROTULO_STATUS_PEDIDO[p.status] ?? p.status
}
