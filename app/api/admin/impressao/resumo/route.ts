import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { ONLINE_SEGUNDOS } from '@/lib/impressao/servico'

/**
 * Resumo da impressão para o botão da impressora no topo (tela v2): se a loja imprime pelo
 * assistente novo, se o computador da Cozinha tem sinal e o NOME da impressora da Cozinha — o
 * apelido que a loja deu, senão o nome do Windows. Qualquer pessoa logada da loja lê (sem dado
 * sensível). Loja no assistente antigo: `beta: false` e o topo segue o sinal do antigo.
 */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const admin = getAdminSupabase()
  const [{ data: loja }, { data: f }] = await Promise.all([
    admin.from('restaurantes').select('impressao_beta_modo').eq('id', sessao.restauranteId).maybeSingle(),
    admin.from('impressao_funcoes').select('impressao_dispositivos ( apelido, nome_sistema, impressao_agentes ( visto_em, revogado_em ) )').eq('restaurante_id', sessao.restauranteId).eq('funcao', 'cozinha').maybeSingle(),
  ])
  const beta = loja?.impressao_beta_modo === 'cozinha_caixa'
  const d = (f as unknown as { impressao_dispositivos: { apelido: string | null; nome_sistema: string; impressao_agentes: { visto_em: string | null; revogado_em: string | null } | null } | null } | null)?.impressao_dispositivos
  const a = d?.impressao_agentes
  const online = !!a && !a.revogado_em && !!a.visto_em && Date.now() - new Date(a.visto_em).getTime() < ONLINE_SEGUNDOS * 1000
  return NextResponse.json({ beta, cozinha: d ? d.apelido || d.nome_sistema : null, online }, { headers: { 'Cache-Control': 'no-store' } })
}
