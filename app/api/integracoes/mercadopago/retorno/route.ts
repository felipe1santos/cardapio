import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { concluirConexao } from '@/lib/pagamentos/contas'
import { verificarChavePix } from '@/lib/pagamentos/pix-online'
import { podeConectarPagamentos, redirecionar } from '@/lib/pagamentos/permissao'
import { registrarAuditoria } from '@/lib/auditoria'

export const dynamic = 'force-dynamic'

/**
 * Volta do Mercado Pago depois da autorização (URL cadastrada na aplicação do MP:
 * https://app.menuzia.com.br/api/integracoes/mercadopago/retorno). O `state` tem de ser desta sessão.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const voltar = (q: string) => redirecionar(`/admin/integracoes?mercadopago=${q}`)
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return redirecionar('/login')
  if (!podeConectarPagamentos(sessao.papel)) return voltar('sem_permissao')
  const state = url.searchParams.get('state') ?? ''
  const codigo = url.searchParams.get('code') ?? ''
  if (url.searchParams.get('error') || !state || !codigo) return voltar('cancelado')
  const admin = getAdminSupabase()
  const r = await concluirConexao(admin, { state, codigo, restauranteId: sessao.restauranteId, usuarioId: sessao.userId })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome ?? 'Dono',
    acao: r.ok ? 'pix_online.conta_conectada' : 'pix_online.conexao_recusada', entidade: 'pagamentos_contas', entidadeId: sessao.restauranteId,
    dados: r.ok ? {} : { motivo: r.motivo },
  })
  if (!r.ok) return voltar('falhou')
  // Conta sem chave Pix: o MP não gera QR. Conecta, mas avisa e a vitrine não oferece o Pix online.
  const chave = await verificarChavePix(admin, sessao.restauranteId)
  return voltar(chave === 'sem_chave' ? 'conectado_sem_chave' : 'conectado')
}
