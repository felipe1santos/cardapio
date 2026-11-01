import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { estadoAlarmeAssistente } from '@/lib/impressao/alarme-assistente'

/**
 * Um alarme só (12/10): o Assistente desta loja está online e tocando o alarme de pedido novo? Sim → o painel fica só
 * visual. A loja vem da sessão. Erro ou sem sessão → { assistente: false } (o painel toca: nunca ficar sem alarme).
 * `semAssistente: true` (01/11) = a loja não tem Assistente: o painel pergunta de novo só em 5 min.
 */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase()).catch(() => null)
  if (!sessao) return NextResponse.json({ assistente: false }, { headers: { 'Cache-Control': 'no-store' } })
  const estado = await estadoAlarmeAssistente(getAdminSupabase(), sessao.restauranteId)
  return NextResponse.json(estado, { headers: { 'Cache-Control': 'no-store' } })
}
