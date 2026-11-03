import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { avisoDaAssinatura } from '@/lib/assinatura/aviso'
import { urlDeFaturaAsaas } from '@/lib/assinatura/repo'

/**
 * Aviso de assinatura para a faixa do painel (03/11/2026): lido 1× ao abrir o painel e a cada 30 min com a aba visível
 * (components/admin/aviso-assinatura.tsx). Só o dono tem assinatura; funcionário recebe `null` sem consultar nada.
 */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase()).catch(() => null)
  if (!sessao) return NextResponse.json({ aviso: null }, { headers: { 'Cache-Control': 'no-store' } })
  if (sessao.papel !== 'dono') return NextResponse.json({ aviso: null }, { headers: { 'Cache-Control': 'no-store' } })
  const admin = getAdminSupabase()
  const [{ data: a }, { data: u }] = await Promise.all([
    admin.from('assinaturas').select('status, proximo_vencimento, ultima_fatura_url').eq('usuario_id', sessao.userId).maybeSingle(),
    admin.from('usuarios').select('acesso_expira_em').eq('id', sessao.userId).maybeSingle(),
  ])
  if (!a) return NextResponse.json({ aviso: null }, { headers: { 'Cache-Control': 'no-store' } })
  const aviso = avisoDaAssinatura({
    status: a.status as 'em_dia', proximoVencimento: a.proximo_vencimento ? String(a.proximo_vencimento).slice(0, 10) : null,
    acessoExpiraEm: (u?.acesso_expira_em as string | null) ?? null, faturaUrl: urlDeFaturaAsaas(a.ultima_fatura_url),
  }, Date.now())
  return NextResponse.json({ aviso }, { headers: { 'Cache-Control': 'no-store' } })
}
