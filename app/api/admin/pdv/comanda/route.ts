import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { listarMesasComEstado, listarPedidosDaComanda } from '@/lib/queries/comandas'

export async function GET(request: Request) {
  const session = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(session)
  if (!restauranteId) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const admin = getAdminSupabase()
  const comandaId = new URL(request.url).searchParams.get('comandaId')

  try {
    if (comandaId) {
      const pedidos = await listarPedidosDaComanda(admin, restauranteId, comandaId)
      return NextResponse.json({ pedidos })
    }
    const mesas = await listarMesasComEstado(admin, restauranteId)
    return NextResponse.json({ mesas })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao carregar comandas'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
