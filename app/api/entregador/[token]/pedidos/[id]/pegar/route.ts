import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarDespachoAberto, buscarEntregadorPorToken, pegarPedidoDisponivel } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/whatsapp'

/** Motoboy pega (self-service) um pedido pronto liberado pela loja — sem login, validado pelo token. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

    const aberto = await buscarDespachoAberto(admin, entregador.restauranteId)
    if (!aberto) return NextResponse.json({ error: 'O despacho não está aberto no momento.' }, { status: 403 })

    await pegarPedidoDisponivel(admin, id, entregador.id, entregador.restauranteId)
    notificarPedido(admin, id, 'em_rota').catch((err) => console.error('[whatsapp] erro ao notificar em rota', err))

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível pegar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
