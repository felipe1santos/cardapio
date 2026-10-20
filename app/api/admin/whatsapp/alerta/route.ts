import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { estadoParaPainel } from '@/lib/whatsapp-monitor'

export const dynamic = 'force-dynamic'

/**
 * Faixa vermelha do painel (Etapa 3, 20/10): o WhatsApp da loja caiu SOZINHO? Checa a Evolution com throttle de 2 min por
 * loja (gratuito); desconexão feita pelo painel não conta. A faixa chama a cada minuto.
 */
export async function GET() {
  const restauranteId = await buscarRestauranteIdDoUsuario(await getServerSupabase())
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  try {
    return NextResponse.json(await estadoParaPainel(getAdminSupabase(), restauranteId), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ caiu: false, desde: null, estado: null }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
