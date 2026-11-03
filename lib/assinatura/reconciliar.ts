import { novaValidade, somarMeses } from './planos'
import { cobrancaPaga } from './webhook'

/**
 * Conferência no login (03/11/2026, regra do dono): loja com validade vencida que pagou tem que voltar sozinha, mesmo
 * que o webhook do Asaas tenha se perdido. Só roda quando alguém expirado tenta entrar (nunca em tela, intervalo ou
 * cron): 1 chamada ao Asaas pela guarda de custo. Acha a cobrança paga mais nova que a última conhecida e aplica a
 * MESMA renovação do webhook (reautoriza + validade = vencimento + 1 mês + 5 dias; vitalícia continua sem validade).
 */
export interface CobrancaListada { id: string; status: string; vencimento: string; faturaUrl: string | null; assinaturaId: string | null }
export interface RepoReconciliar {
  buscarAssinaturaDoUsuario(usuarioId: string): Promise<{ id: string; asaasAssinaturaId: string; ultimaCobrancaId: string | null } | null>
  buscarUsuario(usuarioId: string): Promise<{ id: string; restauranteId: string | null; acessoExpiraEm: string | null } | null>
  renovarAcesso(usuarioId: string, acessoExpiraEm: string | null): Promise<void>
  atualizarAssinatura(id: string, campos: { status: 'em_dia'; ultimaCobrancaId: string; ultimaFaturaUrl: string | null; proximoVencimento: string; pagoEm: string }): Promise<void>
}
export interface DepsReconciliar { repo: RepoReconciliar; listarCobrancas(asaasAssinaturaId: string): Promise<CobrancaListada[]>; agora?: () => Date }

export async function reconciliarAssinatura(usuarioId: string, deps: DepsReconciliar): Promise<'renovado' | 'nada' | 'sem_assinatura'> {
  const ass = await deps.repo.buscarAssinaturaDoUsuario(usuarioId)
  if (!ass) return 'sem_assinatura'
  const usuario = await deps.repo.buscarUsuario(usuarioId)
  if (!usuario?.restauranteId) return 'sem_assinatura'
  const agora = deps.agora?.() ?? new Date()
  const cobrancas = await deps.listarCobrancas(ass.asaasAssinaturaId)
  const pagas = cobrancas
    .filter((c) => c.assinaturaId === ass.asaasAssinaturaId && c.id !== ass.ultimaCobrancaId && cobrancaPaga(c.status))
    .sort((a, b) => (a.vencimento < b.vencimento ? 1 : -1))
  const nova = pagas[0]
  if (!nova) return 'nada'
  // Vitalícia (sem validade) não ganha validade; com validade, a nova nunca encurta e precisa estar no futuro.
  const validade = usuario.acessoExpiraEm === null ? null : novaValidade(usuario.acessoExpiraEm, nova.vencimento)
  if (validade !== null && Date.parse(validade) <= agora.getTime()) return 'nada'
  await deps.repo.renovarAcesso(usuarioId, validade)
  await deps.repo.atualizarAssinatura(ass.id, { status: 'em_dia', ultimaCobrancaId: nova.id, ultimaFaturaUrl: nova.faturaUrl, proximoVencimento: somarMeses(nova.vencimento, 1), pagoEm: agora.toISOString() })
  return 'renovado'
}
