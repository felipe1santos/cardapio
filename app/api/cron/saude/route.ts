import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { alertaDeTeste } from '@/lib/saude/vigia'

export const dynamic = 'force-dynamic'

/**
 * Alerta de teste do vigia da saúde do sistema (28/10/2026), com o cabeçalho `x-cron-secret`:
 *   POST /api/cron/saude  → manda o alerta de teste para o WhatsApp do dono (confere o canal e o formato).
 * O vigia em si roda só dentro do cron do WhatsApp (guarda B2: o mesmo trabalho em dois crons).
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  try {
    return NextResponse.json(await alertaDeTeste(getAdminSupabase()))
  } catch (e) {
    console.error('[cron saude]', (e as Error).message?.slice(0, 160))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
