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

  const admin = getAdminSupabase()

  // Suíte local com provedor simulado (as DUAS variáveis; produção não tem nenhuma):
  // instância cadastrada conta como conectada, para a tela poder ser testada ponta a ponta.
  if (process.env.WHATSAPP_PROVEDOR === 'simulado' && process.env.WHATSAPP_SIMULADO_ARQUIVO) {
    const { data: l } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).single()
    return NextResponse.json({ configurado: true, connected: !!l?.evolution_instance, state: l?.evolution_instance ? 'open' : null })
  }

  if (!evolutionConfigurado()) return NextResponse.json({ configurado: false, connected: false, state: null })

  const { data: loja, error } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).single()
  if (error) return NextResponse.json({ error: 'Erro ao buscar loja' }, { status: 500 })

  if (!loja.evolution_instance) return NextResponse.json({ configurado: true, connected: false, state: null })

  const state = await estadoConexao(loja.evolution_instance)
  return NextResponse.json({ configurado: true, connected: state === 'open', state })
}
