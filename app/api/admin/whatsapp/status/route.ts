import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { estadoConexao, evolutionConfigurado } from '@/lib/evolution'

/** Status da conexão WhatsApp (Evolution) do restaurante logado. */
export async function GET() {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  if (!evolutionConfigurado()) return NextResponse.json({ configurado: false, connected: false, state: null })

  const admin = getAdminSupabase()
  const { data: loja, error } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).single()
  if (error) return NextResponse.json({ error: 'Erro ao buscar loja' }, { status: 500 })

  if (!loja.evolution_instance) return NextResponse.json({ configurado: true, connected: false, state: null })

  const state = await estadoConexao(loja.evolution_instance)
  return NextResponse.json({ configurado: true, connected: state === 'open', state })
}
