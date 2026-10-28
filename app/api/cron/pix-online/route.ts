import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { verificarPendentes } from '@/lib/pagamentos/pix-online'
import { baterCron, umaPorVez } from '@/lib/saude/cron'

export const dynamic = 'force-dynamic'

/**
 * Verificação periódica do Pix online (rede de segurança do webhook), a cada minuto pelo agendamento
 * do Coolify com o cabeçalho `x-cron-secret`. Consulta as cobranças pendentes na API, expira as
 * vencidas (consultando antes) e renova tokens perto de vencer.
 */
export async function POST(request: Request) {
  const segredo = process.env.CRON_SECRET
  if (!segredo || request.headers.get('x-cron-secret') !== segredo) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  void baterCron('pix-online')
  try {
    // Rodada anterior ainda consultando o provedor: a segunda sai sem fazer nada (28/10).
    return NextResponse.json({ ok: true, ...(await umaPorVez('pix-online', () => verificarPendentes(getAdminSupabase()))) })
  } catch (e) {
    console.error('[cron pix-online]', (e as Error).message?.slice(0, 160))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
