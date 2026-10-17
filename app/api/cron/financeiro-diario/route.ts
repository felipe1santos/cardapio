import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { lojasComFinanceiro } from '@/lib/financeiro/nivel'
import { alertasDeVencimento, gerarRecorrencias } from '@/lib/financeiro/contas'

// Cron (Coolify), de hora em hora: POST /api/cron/financeiro-diario com header "x-cron-secret: <CRON_SECRET>".
// Só lojas com o financeiro ligado: gera as próximas contas recorrentes e avisa vencimentos no painel.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const admin = getAdminSupabase()
  // Só com o módulo Financeiro liberado no Super Admin (16/10).
  const lojas = (await lojasComFinanceiro(admin)).map((id) => ({ id }))
  const out = { lojas: 0, recorrencias: 0, alertas: 0, falhas: 0 }
  for (const l of lojas ?? []) {
    try {
      out.recorrencias += await gerarRecorrencias(admin, l.id as string)
      out.alertas += await alertasDeVencimento(admin, l.id as string)
      out.lojas++
    } catch (e) {
      out.falhas++
      console.error('[financeiro-diario] loja', l.id, (e as Error).message?.slice(0, 160))
    }
  }
  return NextResponse.json({ ok: true, ...out })
}
