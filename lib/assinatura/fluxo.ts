/**
 * "Adquirir acesso": cria o usuário (bloqueado) e a assinatura no Asaas; devolve a fatura para o lojista pagar.
 * O acesso só abre quando o webhook confirma o pagamento (lib/assinatura/webhook.ts). docs/ASSINATURA-ASAAS.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarAssinaturaAsaas, criarClienteAsaas, primeiraCobrancaDaAssinatura, AsaasError } from '@/lib/custo/asaas'
import { usuarioDisponivel } from '@/lib/queries/lojistas'
import type { DadosAssinar } from './cadastro'
import { hojeSaoPaulo, PLANOS, valorDoPlano } from './planos'
import { urlDeFaturaAsaas } from './repo'

export type ResultadoAssinar = { ok: true; faturaUrl: string } | { ok: false; erro: string }

const ERRO_GENERICO = 'Não foi possível concluir agora. Tente de novo em instantes.'

export async function iniciarAssinatura(admin: SupabaseClient, d: DadosAssinar): Promise<ResultadoAssinar> {
  // E-mail já cadastrado: se é um cadastro que parou na fatura, devolve a mesma fatura (o lojista tentou de novo).
  const { data: existente, error: erroBusca } = await admin.from('usuarios').select('id, restaurante_id').eq('email', d.email).maybeSingle()
  if (erroBusca) return { ok: false, erro: ERRO_GENERICO }
  if (existente) {
    if (existente.restaurante_id) return { ok: false, erro: 'Este e-mail já tem cadastro. Entre com a sua senha ou recupere a senha.' }
    const { data: a } = await admin.from('assinaturas').select('status, ultima_fatura_url').eq('usuario_id', existente.id).maybeSingle()
    const fatura = urlDeFaturaAsaas(a?.ultima_fatura_url)
    if (a?.status === 'aguardando' && fatura) return { ok: true, faturaUrl: fatura }
    return { ok: false, erro: 'Este e-mail já tem cadastro pendente. Fale com o suporte para concluir.' }
  }
  if (!(await usuarioDisponivel(admin, d.usuario))) return { ok: false, erro: 'Este nome de usuário já está em uso. Escolha outro.' }

  const { data: criado, error: erroAuth } = await admin.auth.admin.createUser({ email: d.email, password: d.senha, email_confirm: true })
  if (erroAuth || !criado.user) {
    if (erroAuth?.message?.toLowerCase().includes('already')) return { ok: false, erro: 'Este e-mail já tem cadastro. Entre com a sua senha ou recupere a senha.' }
    return { ok: false, erro: ERRO_GENERICO }
  }
  const usuarioId = criado.user.id
  const desfazer = async () => {
    await admin.from('assinaturas').delete().eq('usuario_id', usuarioId)
    await admin.from('usuarios').delete().eq('id', usuarioId)
    await admin.auth.admin.deleteUser(usuarioId)
  }

  const { error: erroUsuario } = await admin.from('usuarios').insert({
    id: usuarioId, restaurante_id: null, papel: 'dono', nome: d.nome, email: d.email, telefone: d.telefone, nome_loja: d.nomeLoja, usuario: d.usuario, autorizado: false, acesso_expira_em: null,
  })
  if (erroUsuario) {
    await admin.auth.admin.deleteUser(usuarioId)
    return { ok: false, erro: ERRO_GENERICO }
  }

  try {
    const valor = valorDoPlano(d.plano)
    const clienteId = await criarClienteAsaas(admin, { nome: d.nome, email: d.email, celular: d.telefone, documento: d.documento, referencia: usuarioId })
    const assinaturaId = await criarAssinaturaAsaas(admin, { clienteId, valor, vencimento: hojeSaoPaulo(), descricao: `${PLANOS[d.plano].nome} — ${d.nomeLoja}`, referencia: usuarioId })
    const cobranca = await primeiraCobrancaDaAssinatura(admin, assinaturaId)
    const faturaUrl = urlDeFaturaAsaas(cobranca?.faturaUrl)
    if (!faturaUrl) throw new AsaasError('assinatura sem fatura', null)
    const { error: erroAss } = await admin.from('assinaturas').insert({
      usuario_id: usuarioId, plano: d.plano, valor, documento: d.documento, asaas_cliente_id: clienteId, asaas_assinatura_id: assinaturaId,
      status: 'aguardando', ultima_cobranca_id: cobranca?.id ?? null, ultima_fatura_url: faturaUrl, proximo_vencimento: cobranca?.vencimento || hojeSaoPaulo(),
    })
    if (erroAss) throw erroAss
    return { ok: true, faturaUrl }
  } catch (e) {
    console.error('[assinatura] falha ao criar no Asaas', (e as Error).message)
    await desfazer().catch((e2) => console.error('[assinatura] falha ao desfazer', (e2 as Error).message))
    return { ok: false, erro: e instanceof AsaasError ? e.message : ERRO_GENERICO }
  }
}
