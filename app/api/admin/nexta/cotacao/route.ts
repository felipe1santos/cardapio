import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { cotarEntrega } from '@/lib/nexta'
import { carregarConfigNexta, carregarPedidoNexta, erroNexta, montarEntregaDoPedido, resolverCoordenadasColeta } from '@/lib/nexta-servidor'

/**
 * Preço e ETA do Nexta para um pedido — alimenta o chip de cotação do painel de despacho.
 *
 * `/availability` não cria nada do lado do Nexta, então pode ser chamada à vontade; ainda
 * assim o painel cacheia por 2 min (lib/nexta-cotacao-cache.ts) pra não bater a cada
 * refetch do realtime.
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
  try {
    const cfg = await resolverCoordenadasColeta(admin, await carregarConfigNexta(admin, restauranteId))
    const pedido = await carregarPedidoNexta(admin, restauranteId, pedidoId)

    const { data: coord } = await admin.from('pedidos').select('entrega_latitude, entrega_longitude').eq('id', pedidoId).maybeSingle()
    const entrega = await montarEntregaDoPedido(admin, cfg, pedido, {
      lat: coord?.entrega_latitude ?? null,
      lng: coord?.entrega_longitude ?? null,
    })

    const cotacao = await cotarEntrega(cfg, entrega, { totalPedido: pedido.total, taxaEntrega: pedido.taxaEntrega })
    return NextResponse.json({
      preco: cotacao.preco,
      etaColetaMin: cotacao.etaColetaMin,
      etaEntregaMin: cotacao.etaEntregaMin,
    })
  } catch (err) {
    const { mensagem, status } = erroNexta(err)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
