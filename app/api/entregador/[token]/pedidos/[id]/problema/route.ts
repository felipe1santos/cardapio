import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEntregadorPorToken, marcarEntregaComProblema } from '@/lib/queries/pedidos'

/** Motoboy sinaliza que não conseguiu entregar um pedido da sua rota — sem login, validado pelo token. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  try {
    const entregador = await buscarEntregadorPorToken(admin, token)
    if (!entregador) return NextResponse.json({ error: 'Link inválido' }, { status: 404 })

    await marcarEntregaComProblema(admin, id, entregador.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível atualizar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
