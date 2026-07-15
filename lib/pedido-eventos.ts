import type { SupabaseClient } from '@supabase/supabase-js'
import { processarFidelidadePedidoEntregue, reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { marcarPreparandoNotificado, type StatusPedido } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/whatsapp'

/**
 * Efeitos colaterais de uma etapa do pedido: avisa o cliente no WhatsApp e roda o motor
 * de fidelidade nos marcos que importam.
 *
 * Existe porque o status do pedido passou a ter DOIS disparadores: o painel (que chama
 * /api/pedidos/[id]/notificar) e o webhook do Nexta (que move o pedido sozinho quando o
 * motoboy coleta/entrega). Sem um ponto único, uma entrega feita pelo Nexta deixaria de
 * pontuar fidelidade — regressão silenciosa e cara.
 *
 * Fogo-e-esquece por natureza: nenhum destes efeitos pode derrubar a transição de status
 * que já aconteceu, então tudo aqui é try/catch + log.
 */
export async function aplicarEfeitosStatusPedido(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<void> {
  await notificarPedido(admin, pedidoId, status)

  if (status !== 'entregue' && status !== 'cancelado') return

  // Os dois motores checam o status real no banco antes de agir, então não viram vetor
  // de abuso mesmo vindo de uma rota sem autenticação.
  const { data: pedido } = await admin.from('pedidos').select('restaurante_id').eq('id', pedidoId).maybeSingle()
  if (!pedido) return

  if (status === 'entregue') {
    processarFidelidadePedidoEntregue(admin, pedido.restaurante_id, pedidoId).catch((err) => console.error('[fidelidade]', err))
  } else {
    reverterBeneficiosPedidoCancelado(admin, pedido.restaurante_id, pedidoId).catch((err) => console.error('[fidelidade]', err))
  }
}

/**
 * Idem, mas com a trava de "em preparo só notifica uma vez por pedido" (idempotente
 * entre Kanban e portal da cozinha). Retorna false quando a notificação já tinha saído.
 */
export async function aplicarEfeitosStatusPedidoComTrava(admin: SupabaseClient, pedidoId: string, status: StatusPedido): Promise<boolean> {
  if (status === 'preparando' && !(await marcarPreparandoNotificado(admin, pedidoId))) return false
  await aplicarEfeitosStatusPedido(admin, pedidoId, status)
  return true
}
