import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarStatusPedido } from '@/lib/queries/pedidos'

/** Acompanhamento do pedido pela vitrine (polling), sem expor dados de outras lojas. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = await params
  const admin = getAdminSupabase()

  try {
    const status = await buscarStatusPedido(admin, id)
    if (!status) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
    return NextResponse.json(status)
  } catch {
    return NextResponse.json({ error: 'Erro ao consultar o pedido' }, { status: 500 })
  }
}
