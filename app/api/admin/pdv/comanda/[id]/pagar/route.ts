import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { marcarComandaPaga } from '@/lib/queries/comandas'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdminSupabase()
  try {
    await marcarComandaPaga(admin, restauranteId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar pagamento'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
