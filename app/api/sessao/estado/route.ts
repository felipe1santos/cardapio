import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { dispositivoDaRequisicao, telaTravada } from '@/lib/financeiro/contexto'

/** Estado da sessão para o painel: módulo financeiro ligado, PIN, inatividade e trava (0132). */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const admin = getAdminSupabase()
  const d = await dispositivoDaRequisicao()
  const [{ data: loja }, { data: u }, { data: cfg }, travada] = await Promise.all([
    admin.from('restaurantes').select('financeiro_ativo').eq('id', sessao.restauranteId).maybeSingle(),
    admin.from('usuarios').select('pin_hash').eq('id', sessao.userId).maybeSingle(),
    admin.from('fin_config').select('inatividade_min').eq('restaurante_id', sessao.restauranteId).maybeSingle(),
    telaTravada(admin, sessao.userId, d.terminal),
  ])
  const financeiroAtivo = !!loja?.financeiro_ativo
  return NextResponse.json({
    financeiroAtivo,
    temPin: !!u?.pin_hash,
    inatividadeMin: (cfg?.inatividade_min as number | undefined) ?? 5,
    // Com o módulo desligado a trava não existe (nada fica preso por um resto de teste).
    travada: financeiroAtivo && travada,
    nome: sessao.nome,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
