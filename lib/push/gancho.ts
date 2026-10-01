import { registrarGanchoPushStatus } from '@/lib/whatsapp'
import { enviarPushStatusPedido } from './motor'

/** Liga o push do status do pedido ao notificarPedido (chamado no boot do servidor). */
export function registrarPush() {
  registrarGanchoPushStatus((admin, pedidoId, status) => enviarPushStatusPedido(admin, pedidoId, status))
}
