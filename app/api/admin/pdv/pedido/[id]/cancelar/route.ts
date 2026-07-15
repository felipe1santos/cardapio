import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { cancelarPedidoComanda } from '@/lib/queries/comandas'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdminSupabase()
  try {
    await cancelarPedidoComanda(admin, restauranteId, id)
    reverterBeneficiosPedidoCancelado(admin, restauranteId, id).catch(console.error)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao cancelar pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
