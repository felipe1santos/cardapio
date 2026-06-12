import type { StatusPedido } from '@/lib/queries/pedidos'

/** Pede ao servidor para enviar a notificação de WhatsApp da nova etapa do pedido. Fogo-e-esquece. */
export function notificarPedido(pedidoId: string, status: StatusPedido) {
  fetch(`/api/pedidos/${pedidoId}/notificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  }).catch(() => {})
}
