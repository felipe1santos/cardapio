import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { dispositivoDaRequisicao, telaTravada } from '@/lib/financeiro/contexto'
import { nivelDe } from '@/lib/financeiro/nivel'
import { modulosDaLoja, whatsappComercial } from '@/lib/modulos'

/** Estado da sessão para o painel: módulo financeiro ligado, controle de caixa (nível 2), PIN, inatividade e trava (0132). */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const admin = getAdminSupabase()
  const d = await dispositivoDaRequisicao()
  const [{ data: loja }, { data: u }, { data: cfg }, travada, modulos] = await Promise.all([
    admin.from('restaurantes').select('nome, financeiro_ativo, controle_caixa_ativo').eq('id', sessao.restauranteId).maybeSingle(),
    admin.from('usuarios').select('pin_hash').eq('id', sessao.userId).maybeSingle(),
    admin.from('fin_config').select('inatividade_min').eq('restaurante_id', sessao.restauranteId).maybeSingle(),
    telaTravada(admin, sessao.userId, d.terminal),
    modulosDaLoja(admin, sessao.restauranteId),
  ])
  // Módulo Financeiro bloqueado (0176): a tela age como sem financeiro — o caixa automático segue gravando por baixo.
  const nivel = nivelDe(loja)
  const financeiroAtivo = nivel.financeiro && modulos.financeiro
  const controleCaixa = nivel.controleCaixa && modulos.financeiro
  return NextResponse.json({
    financeiroAtivo,
    // Nível 2 (0167): caixa à mão, trava de tela, troca de operador e aviso de caixa.
    controleCaixa,
    temPin: !!u?.pin_hash,
    inatividadeMin: (cfg?.inatividade_min as number | undefined) ?? 5,
    // Sem o controle de caixa a trava não existe (nada fica preso por um resto de teste).
    travada: controleCaixa && travada,
    nome: sessao.nome,
    // Módulos pagos (0176): o menu mostra os bloqueados meio apagados, com cadeado e o "Quero liberar".
    modulos,
    lojaNome: (loja?.nome as string | undefined) ?? '',
    whatsappComercial: whatsappComercial(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
