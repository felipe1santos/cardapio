import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { desconectarInstancia } from '@/lib/evolution'
import { marcarDesconexaoManual } from '@/lib/whatsapp-monitor'

/** Desconecta o WhatsApp do restaurante logado (mantém a instância para reconectar depois). */
export async function POST() {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = getAdminSupabase()
  const { data: loja, error } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).single()
  if (error) return NextResponse.json({ error: 'Erro ao buscar loja' }, { status: 500 })
  if (!loja.evolution_instance) return NextResponse.json({ ok: true })

  // Etapa 3 (20/10): desconexão feita no painel não dispara o alerta de "caiu sozinho". A marca vem ANTES do logout
  // (revisão 26/10): o "close" do logout chega pelo webhook e precisa já encontrá-la.
  await marcarDesconexaoManual(admin, restauranteId).catch(() => null)
  await desconectarInstancia(loja.evolution_instance)
  return NextResponse.json({ ok: true })
}
