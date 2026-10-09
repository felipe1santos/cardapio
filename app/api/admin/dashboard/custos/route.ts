import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'

/**
 * Custo de cada pedido do período (centavos), para o lucro do gráfico do Dashboard (0165). Só dono e gerente
 * veem lucro e margem. Só entram pedidos com custo em TODAS as linhas (ficha ou preço de custo do cardápio).
 *   GET ?de=<ISO>&ate=<ISO>   (ate exclusivo)
 */
export async function GET(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!['dono', 'gerente'].includes(sessao.papel)) return NextResponse.json({ error: 'Só o dono e o gerente veem o lucro.' }, { status: 403 })
  const u = new URL(request.url).searchParams
  const de = Date.parse(u.get('de') ?? ''), ate = Date.parse(u.get('ate') ?? '')
  if (!Number.isFinite(de) || !Number.isFinite(ate) || ate <= de || ate - de > 800 * 86_400_000) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
  const admin = getAdminSupabase()
  const { data, error } = await admin.rpc('dashboard_custos_pedidos', { p_restaurante: sessao.restauranteId, p_ini: new Date(de).toISOString(), p_fim: new Date(ate).toISOString() })
  if (error) return NextResponse.json({ error: 'Não foi possível calcular o lucro.' }, { status: 500 })
  const custos: Record<string, number> = {}
  for (const r of (data ?? []) as { pedido_id: string; custo_centavos: number }[]) custos[r.pedido_id] = Number(r.custo_centavos)
  return NextResponse.json({ custos }, { headers: { 'Cache-Control': 'no-store' } })
}
