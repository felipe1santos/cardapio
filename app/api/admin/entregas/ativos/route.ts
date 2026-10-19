import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { provedoresAtivos } from '@/lib/entregas/provedores'

export const dynamic = 'force-dynamic'

/** O Kanban pergunta quais botões de entregador mostrar (Lalamove, iFood, Foody): módulo liberado + ligado + credenciais. */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ ativos: [] }, { headers: { 'Cache-Control': 'no-store' } })
  const ativos = await provedoresAtivos(getAdminSupabase(), sessao.restauranteId).catch(() => [])
  return NextResponse.json({ ativos }, { headers: { 'Cache-Control': 'no-store' } })
}
