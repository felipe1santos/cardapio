import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { varrerLoja } from '@/lib/financeiro/vigia'

// Cron (Coolify), a cada 15 min: POST /api/cron/financeiro-vigia com header "x-cron-secret: <CRON_SECRET>".
// Só lojas com o financeiro ligado: alertas que dependem de tempo (caixa esquecido, caixa sem abrir, motoboy com
// dinheiro há horas) e de olhar o conjunto (desconto alto, sangria alta, cancelamento depois de pago, ações
// sensíveis demais). Cada alerta tem chave e não se repete.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  // Relógio adiantado SÓ no servidor local de teste (VIGIA_RELOGIO_TESTE=1): testa alertas de 'há X horas'.
  const relogio = process.env.VIGIA_RELOGIO_TESTE === '1' ? Date.parse(request.headers.get('x-vigia-agora') ?? '') : NaN
  const agora = Number.isFinite(relogio) ? relogio : Date.now()
  const admin = getAdminSupabase()
  const { data: lojas } = await admin.from('restaurantes').select('id').eq('financeiro_ativo', true)
  const total: Record<string, number> = {}
  let falhas = 0
  for (const l of lojas ?? []) {
    try {
      const n = await varrerLoja(admin, l.id as string, agora)
      for (const [k, v] of Object.entries(n)) total[k] = (total[k] ?? 0) + v
    } catch (e) {
      falhas++
      console.error('[financeiro-vigia] loja', l.id, (e as Error).message?.slice(0, 160))
    }
  }
  return NextResponse.json({ ok: true, lojas: lojas?.length ?? 0, alertas: total, falhas })
}
