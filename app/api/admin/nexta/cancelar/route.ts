import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { cancelarEntrega, NextaError, type NextaAcaoCancelamento, type NextaMotivoCancelamento } from '@/lib/nexta'
import { carregarConfigNexta, erroNexta } from '@/lib/nexta-servidor'
import { atualizarNextaEntrega, buscarNextaEntregaAtivaDoPedido, desvincularEntregaDoPedido } from '@/lib/queries/nexta'

const MOTIVOS: NextaMotivoCancelamento[] = [
  'PROBLEM_AT_MERCHANT',
  'CONSUMER_CANCELLATION_REQUESTED',
  'NO_SHOW',
  'HIGH_ACCEPTANCE_TIME',
  'INCORRECT_ORDER_OR_PRODUCT_PICKUP',
  'PROBLEM_RESOLUTION',
  'DISCOMBINE_ORDER',
  'OTHER',
]

const ACOES: NextaAcaoCancelamento[] = ['RETURN_TO_STORE', 'CANCEL_DELIVERY']

/**
 * Cancela a corrida no Nexta e devolve o pedido para a fila de despacho.
 *
 * `additionalCharges` volta pro painel avisar o lojista que o cancelamento teve custo.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let corpo: { pedidoId?: string; reason?: string; action?: string; message?: string }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const pedidoId = corpo.pedidoId ?? ''
  if (!pedidoId) return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 })

  const motivo = MOTIVOS.includes(corpo.reason as NextaMotivoCancelamento) ? (corpo.reason as NextaMotivoCancelamento) : 'PROBLEM_AT_MERCHANT'
  const acao = ACOES.includes(corpo.action as NextaAcaoCancelamento) ? (corpo.action as NextaAcaoCancelamento) : 'CANCEL_DELIVERY'

  const admin = getAdminSupabase()
  try {
    const cfg = await carregarConfigNexta(admin, restauranteId)
    const entrega = await buscarNextaEntregaAtivaDoPedido(admin, pedidoId)
    if (!entrega || entrega.restauranteId !== restauranteId) {
      throw new NextaError('Este pedido não tem uma entrega ativa no Nexta.', 404, null)
    }

    const { additionalCharges } = await cancelarEntrega(cfg, entrega.id, motivo, acao, corpo.message ?? '')

    // Marca o estado local na hora em vez de esperar o webhook CANCELLED: o lojista
    // acabou de cancelar e precisa ver o pedido voltar pro despacho agora. Se o webhook
    // chegar depois, a máquina de estados trata como repetição e não faz nada.
    await atualizarNextaEntrega(admin, entrega.id, { status: 'CANCELLED', cancelAdditionalCharges: additionalCharges })
    await desvincularEntregaDoPedido(admin, pedidoId, entrega.id)

    // Pedido que já tinha saído para entrega volta para a fila; `pronto` continua pronto.
    const { error } = await admin.from('pedidos').update({ status: 'pronto' }).eq('id', pedidoId).eq('status', 'em_rota')
    if (error) throw error

    return NextResponse.json({ ok: true, additionalCharges })
  } catch (err) {
    const { mensagem, status } = erroNexta(err)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
