import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken, marcarEntregaConcluida } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/whatsapp'

/** Motoboy confirma a entrega de um pedido da sua rota — sem login, validado pelo token. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

    await marcarEntregaConcluida(admin, id, entregador.id)
    notificarPedido(admin, id, 'entregue').catch((err) => console.error('[whatsapp] erro ao notificar entrega', err))

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível confirmar a entrega'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
