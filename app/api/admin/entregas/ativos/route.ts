import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { provedoresAtivos } from '@/lib/entregas/provedores'
import { pixOnlineDaLoja } from '@/lib/pagamentos/pix-online'

export const dynamic = 'force-dynamic'

/** O Kanban pergunta quais botões de entregador mostrar (Lalamove, iFood, Foody): módulo liberado + ligado + credenciais. */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ ativos: [] }, { headers: { 'Cache-Control': 'no-store' } })
  const admin = getAdminSupabase()
  const [ativos, pix] = await Promise.all([provedoresAtivos(admin, sessao.restauranteId).catch(() => []), pixOnlineDaLoja(admin, sessao.restauranteId).catch(() => ({ ativo: false }))])
  // pixOnline (21/10): sem Pix online, o card não oferece parceiro que não recebe na entrega em pedido a receber.
  return NextResponse.json({ ativos, pixOnline: pix.ativo }, { headers: { 'Cache-Control': 'no-store' } })
}
