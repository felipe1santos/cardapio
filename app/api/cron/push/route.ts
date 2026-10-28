import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { cicloPush } from '@/lib/push/ciclo'
import { baterCron } from '@/lib/saude/cron'

/**
 * Cron das notificações push (0127) — mesma proteção do cron de campanhas (`x-cron-secret`).
 * Cron próprio no Coolify ("Push do app", a cada 60 s) — o ÚNICO que roda o ciclo (até 22/10 rodava também no de
 * campanhas, 2× por minuto). As automações de cada loja só são avaliadas a cada 10 min (trava em push_config).
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  void baterCron('push')
  try {
    return NextResponse.json(await cicloPush(getAdminSupabase(), { forcar: new URL(request.url).searchParams.get('forcar') === '1' }))
  } catch (err) {
    console.error('[cron/push] erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
