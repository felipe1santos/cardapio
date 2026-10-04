import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { gravarAncoras } from '@/lib/financeiro/ancora'

// Cron diário (Coolify): POST /api/cron/ancora-integridade com header "x-cron-secret: <CRON_SECRET>".
// Grava fora do banco o último hash do livro-caixa e da auditoria de cada loja (0141).
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  try {
    const r = await gravarAncoras(getAdminSupabase())
    console.log(`[ancora-integridade] ${r.lojas} loja(s) em ${r.arquivo}`)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error('[ancora-integridade] falha', e)
    return NextResponse.json({ error: 'Não foi possível gravar a âncora.' }, { status: 500 })
  }
}
