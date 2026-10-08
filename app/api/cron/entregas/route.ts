import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { despacharAutomaticamente, marcarEntreguesAutomaticos } from '@/lib/motoboy/despacho-automatico'

// Cron (Coolify), a cada minuto: POST /api/cron/entregas com header "x-cron-secret: <CRON_SECRET>".
// Item 61: (1) pedido em rota há 1h30 sem o motoboy confirmar → "Entregue (automático)";
// (2) lojas com o despacho automático ligado: despacha os prontos que ficaram sem motoboy
// (ninguém disponível na hora em que ficaram prontos).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const admin = getAdminSupabase()
  let entregues = 0
  try { entregues = await marcarEntreguesAutomaticos(admin) } catch (e) { console.error('[cron entregas] entregue automático', (e as Error).message) }
  const { data: lojas } = await admin.from('restaurantes').select('id').eq('despacho_automatico', true)
  let despachados = 0
  for (const l of (lojas ?? []) as { id: string }[]) {
    try { despachados += (await despacharAutomaticamente(admin, l.id)).despachados.length } catch (e) { console.error('[cron entregas] despacho', l.id, (e as Error).message) }
  }
  return NextResponse.json({ ok: true, entregues, lojas: lojas?.length ?? 0, despachados })
}
