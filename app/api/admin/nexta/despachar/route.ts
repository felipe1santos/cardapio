import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { cotarEntrega, criarEntrega } from '@/lib/nexta'
import { carregarConfigNexta, carregarPedidoNexta, erroNexta, montarEntregaDoPedido, pedidoParaNexta, resolverCoordenadasColeta } from '@/lib/nexta-servidor'
import { apagarNextaEntrega, atualizarNextaEntrega, criarNextaEntrega, vincularEntregaAoPedido } from '@/lib/queries/nexta'

/** Pedido fora do estado esperado — erro nosso, não do Nexta. */
class PedidoForaDeEstadoError extends Error {}

/**
 * Solicita a entrega de um pedido ao Nexta.
 *
 * O status do pedido NÃO muda aqui: ele segue `pronto` até o motoboy coletar de verdade
 * (evento ORDER_PICKED, via webhook). Assim o pedido não aparece "em rota" enquanto o
 * Nexta ainda nem aceitou a corrida.
 *
 * A resposta é 202/PENDING — aceite ou recusa chegam depois, por webhook.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let pedidoId: string
  try {
    pedidoId = ((await request.json()) as { pedidoId?: string }).pedidoId ?? ''
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (!pedidoId) return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 })

  const admin = getAdminSupabase()
  let entregaId: string | null = null
  try {
    const cfg = await resolverCoordenadasColeta(admin, await carregarConfigNexta(admin, restauranteId))
    const pedido = await carregarPedidoNexta(admin, restauranteId, pedidoId)
    if (pedido.status !== 'pronto') {
      throw new PedidoForaDeEstadoError(`O pedido #${pedido.numero} não está pronto para despacho.`)
    }

    const { data: coord } = await admin.from('pedidos').select('entrega_latitude, entrega_longitude').eq('id', pedidoId).maybeSingle()
    const entrega = await montarEntregaDoPedido(admin, cfg, pedido, {
      lat: coord?.entrega_latitude ?? null,
      lng: coord?.entrega_longitude ?? null,
    })

    // Recota SEMPRE, ignorando o cache do painel: mandar a corrida com um preço de 2
    // minutos atrás é o caminho pra surpresa na fatura.
    const cotacao = await cotarEntrega(cfg, entrega, { totalPedido: pedido.total, taxaEntrega: pedido.taxaEntrega })

    // Reserva a linha ANTES de falar com o Nexta: o índice parcial
    // `nexta_entregas_ativa_por_pedido` é quem impede dois cliques virarem duas corridas.
    const linha = await criarNextaEntrega(admin, restauranteId, pedidoId, {
      preco: cotacao.preco,
      bruto: cotacao.bruto,
      etaColetaEm: cotacao.etaColetaEm,
      etaEntregaEm: cotacao.etaEntregaEm,
    })
    entregaId = linha.id

    // O id da linha é o `orderId` que o Nexta passa a conhecer (e que aparece no painel
    // deles como "ID da Integração").
    const criacao = await criarEntrega(cfg, pedidoParaNexta(pedido), entrega, linha.id)

    await atualizarNextaEntrega(admin, linha.id, { deliveryId: criacao.deliveryId, status: criacao.evento })
    await vincularEntregaAoPedido(admin, pedidoId, linha.id)

    return NextResponse.json({
      ok: true,
      entregaId: linha.id,
      deliveryId: criacao.deliveryId,
      status: criacao.evento,
      preco: cotacao.preco,
    })
  } catch (err) {
    // A corrida não nasceu do lado do Nexta — a linha reservada não pode ficar segurando
    // o índice parcial e travando a próxima tentativa.
    if (entregaId) {
      try {
        await apagarNextaEntrega(admin, entregaId)
      } catch (limpezaErr) {
        console.error(`[nexta] falha ao limpar a entrega ${entregaId} depois de um despacho falho:`, limpezaErr)
      }
    }
    if (err instanceof PedidoForaDeEstadoError) return NextResponse.json({ error: err.message }, { status: 409 })
    const { mensagem, status } = erroNexta(err)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
