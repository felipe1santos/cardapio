'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { registrarAuditoria } from '@/lib/auditoria'
import { alterarValidadeLojista, concederAcessoLojista, convidarLojista, excluirLojistaCompleto, removerConvitePendente, revogarAcessoLojista } from '@/lib/queries/lojistas'
import { auditarPlataforma } from '@/lib/queries/plataforma'

/**
 * Ações do Painel da plataforma. Todas conferem o superadmin NO SERVIDOR (o layout só esconde
 * a tela), devolvem o resultado para o modal/toast e ficam na auditoria da plataforma (0139);
 * as que mexem numa loja também entram na auditoria da própria loja.
 */
export type ResultadoAcao = { ok: true; mensagem: string } | { ok: false; erro: string }

async function ensureSuperAdmin() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!isSuperAdminEmail(data.user?.email)) {
    redirect('/login')
  }
  return { id: data.user!.id, email: data.user!.email ?? 'superadmin' }
}

const UUID = /^[0-9a-f-]{36}$/i

/** "2026-12-31" (data escolhida no modal) → fim do dia em São Paulo, em ISO. Vazio = sem validade. */
function validadeDaData(data: string | null | undefined): string | null | 'invalida' {
  const d = (data ?? '').trim()
  if (!d) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'invalida'
  const t = new Date(`${d}T23:59:59-03:00`)
  if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return 'invalida'
  return t.toISOString()
}

async function dadosDaConta(usuarioId: string) {
  const admin = getAdminSupabase()
  const { data } = await admin.from('usuarios').select('email, restaurante_id, restaurantes(nome)').eq('id', usuarioId).maybeSingle()
  const loja = (data?.restaurantes as { nome?: string } | null)?.nome ?? null
  return { admin, email: (data?.email as string | undefined) ?? '', restauranteId: (data?.restaurante_id as string | null) ?? null, loja }
}

function terminar(r: ResultadoAcao): ResultadoAcao {
  if (r.ok) revalidatePath('/superadmin')
  return r
}

export async function preCadastrarAction(entrada: { email: string; nomeLoja?: string; nome?: string; telefone?: string; validade?: string }): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  const validade = validadeDaData(entrada.validade)
  if (validade === 'invalida') return { ok: false, erro: 'A validade precisa ser uma data futura.' }
  const admin = getAdminSupabase()
  const r = await convidarLojista(admin, { email: entrada.email ?? '', nomeLoja: entrada.nomeLoja, nome: entrada.nome, telefone: entrada.telefone, acessoExpiraEm: validade })
  if (!r.ok) return { ok: false, erro: r.error }
  await auditarPlataforma(admin, { ator: quem.email, acao: 'plataforma.pre_cadastrou', usuarioId: r.usuarioId, alvo: entrada.email.trim().toLowerCase(), dados: { comValidade: !!validade, nomeLoja: entrada.nomeLoja ?? '' } })
  return terminar({ ok: true, mensagem: 'Cliente pré-cadastrado. Ele já pode concluir o cadastro em /cadastro.' })
}

export async function removerPreCadastroAction(usuarioId: string): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  if (!UUID.test(usuarioId)) return { ok: false, erro: 'Conta inválida.' }
  const { admin, email } = await dadosDaConta(usuarioId)
  const r = await removerConvitePendente(admin, usuarioId)
  if (!r.ok) return { ok: false, erro: r.error }
  await auditarPlataforma(admin, { ator: quem.email, acao: 'plataforma.removeu_pre_cadastro', usuarioId, alvo: email })
  return terminar({ ok: true, mensagem: 'Pré-cadastro removido.' })
}

export async function bloquearAction(usuarioId: string): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  if (!UUID.test(usuarioId)) return { ok: false, erro: 'Conta inválida.' }
  const { admin, restauranteId, loja } = await dadosDaConta(usuarioId)
  const r = await revogarAcessoLojista(admin, usuarioId)
  if (!r.ok) return { ok: false, erro: r.error }
  await auditarPlataforma(admin, { ator: quem.email, acao: 'plataforma.bloqueou', restauranteId, usuarioId, alvo: loja })
  if (restauranteId) await registrarAuditoria(admin, { restauranteId, usuarioNome: `Plataforma (${quem.email})`, acao: 'plataforma.bloqueou', entidade: 'restaurante', entidadeId: restauranteId })
  return terminar({ ok: true, mensagem: 'Acesso bloqueado. A loja não entra até você desbloquear.' })
}

export async function desbloquearAction(usuarioId: string, validade?: string): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  if (!UUID.test(usuarioId)) return { ok: false, erro: 'Conta inválida.' }
  const v = validadeDaData(validade)
  if (v === 'invalida') return { ok: false, erro: 'A validade precisa ser uma data futura.' }
  const { admin, restauranteId, loja } = await dadosDaConta(usuarioId)
  const dias = v ? Math.max(1, Math.ceil((new Date(v).getTime() - Date.now()) / 86_400_000)) : 0
  const r = await concederAcessoLojista(admin, usuarioId, dias)
  if (!r.ok) return { ok: false, erro: r.error }
  if (v) await alterarValidadeLojista(admin, usuarioId, v) // a data exata escolhida, não "N dias"
  await auditarPlataforma(admin, { ator: quem.email, acao: 'plataforma.desbloqueou', restauranteId, usuarioId, alvo: loja, dados: { validade: v } })
  if (restauranteId) await registrarAuditoria(admin, { restauranteId, usuarioNome: `Plataforma (${quem.email})`, acao: 'plataforma.desbloqueou', entidade: 'restaurante', entidadeId: restauranteId })
  return terminar({ ok: true, mensagem: 'Acesso liberado.' })
}

export async function alterarValidadeAction(usuarioId: string, validade: string): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  if (!UUID.test(usuarioId)) return { ok: false, erro: 'Conta inválida.' }
  const v = validadeDaData(validade)
  if (v === 'invalida') return { ok: false, erro: 'A validade precisa ser uma data futura.' }
  const { admin, restauranteId, loja, email } = await dadosDaConta(usuarioId)
  const r = await alterarValidadeLojista(admin, usuarioId, v)
  if (!r.ok) return { ok: false, erro: r.error }
  await auditarPlataforma(admin, { ator: quem.email, acao: 'plataforma.alterou_validade', restauranteId, usuarioId, alvo: loja ?? email, dados: { validade: v } })
  if (restauranteId) await registrarAuditoria(admin, { restauranteId, usuarioNome: `Plataforma (${quem.email})`, acao: 'plataforma.alterou_validade', entidade: 'restaurante', entidadeId: restauranteId, dados: { validade: v } })
  return terminar({ ok: true, mensagem: v ? 'Validade alterada.' : 'Acesso sem validade.' })
}

export async function excluirDadosAction(usuarioId: string, confirmacao: string): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  if (!UUID.test(usuarioId)) return { ok: false, erro: 'Conta inválida.' }
  const { admin, restauranteId, loja } = await dadosDaConta(usuarioId)
  if (!loja || confirmacao.trim().toLowerCase() !== loja.trim().toLowerCase()) return { ok: false, erro: 'Digite o nome da loja exatamente para confirmar.' }
  const r = await excluirLojistaCompleto(admin, usuarioId)
  if (!r.ok) return { ok: false, erro: r.error }
  await auditarPlataforma(admin, { ator: quem.email, acao: 'plataforma.excluiu_dados', usuarioId, alvo: loja, dados: { restauranteId } })
  return terminar({ ok: true, mensagem: 'Loja e dados excluídos.' })
}

/**
 * Piloto do Assistente de Impressão Beta (0100): libera ou retira UMA loja. Liberar só
 * permite gerar código de pareamento e escolher o modo — a loja continua em "Somente
 * teste" e a cozinha no Assistente antigo até o dono mudar. Retirar volta a loja para
 * "Somente teste" (a cozinha retorna ao antigo) antes de tirar a liberação.
 */
export async function alternarBetaImpressaoAction(restauranteId: string, liberar: boolean): Promise<ResultadoAcao> {
  const quem = await ensureSuperAdmin()
  if (!UUID.test(restauranteId)) return { ok: false, erro: 'Loja inválida.' }
  const admin = getAdminSupabase()
  if (!liberar) {
    const { error: e1 } = await admin.rpc('impressao_modo_definir', { p_restaurante: restauranteId, p_modo: 'teste', p_ator: null, p_ator_nome: 'Plataforma' })
    if (e1) return { ok: false, erro: 'Não foi possível voltar a loja para o Assistente antigo.' }
  }
  const { error } = await admin.from('restaurantes').update({ impressao_beta_liberado: liberar }).eq('id', restauranteId)
  if (error) return { ok: false, erro: 'Não foi possível alterar o piloto de impressão.' }
  await registrarAuditoria(admin, {
    restauranteId, usuarioId: null, usuarioNome: `Plataforma (${quem.email})`,
    acao: liberar ? 'impressao.beta_liberado' : 'impressao.beta_retirado', entidade: 'restaurante', entidadeId: restauranteId, dados: {},
  })
  await auditarPlataforma(admin, { ator: quem.email, acao: liberar ? 'plataforma.beta_liberou' : 'plataforma.beta_retirou', restauranteId })
  return terminar({ ok: true, mensagem: liberar ? 'Impressão Beta liberada para a loja.' : 'Loja retirada do piloto de impressão.' })
}

export async function sairAction() {
  const supabase = await getServerSupabase()
  await supabase.auth.signOut()
  redirect('/login')
}
