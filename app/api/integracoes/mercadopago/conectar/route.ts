import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { iniciarConexao } from '@/lib/pagamentos/contas'
import { mpConfigurado } from '@/lib/pagamentos/mercadopago'
import { podeConectarPagamentos, redirecionar } from '@/lib/pagamentos/permissao'

export const dynamic = 'force-dynamic'

/** "Conectar Mercado Pago" (Integrações): só o DONO. Leva ao MP para a loja autorizar a PRÓPRIA conta. */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  const voltar = (q: string) => redirecionar(`/admin/integracoes?mercadopago=${q}`)
  if (!sessao) return redirecionar('/login')
  if (!podeConectarPagamentos(sessao.papel)) return voltar('sem_permissao')
  if (!mpConfigurado()) return voltar('nao_configurado')
  const url = await iniciarConexao(getAdminSupabase(), { restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome ?? null })
  return redirecionar(url)
}
