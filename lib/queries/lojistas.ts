import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'

export type PapelUsuario = 'dono' | 'atendente' | 'cozinha' | 'logistica' | 'entregador'

type Resultado = { ok: true } | { ok: false; error: string }

const DIACRITICS_REGEX = new RegExp('[̀-ͯ]', 'g')

/** Normaliza um texto para uso como slug de loja (minúsculas, sem acento, só a-z0-9-). */
export function normalizarSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function gerarSlugUnico(admin: SupabaseClient, nomeLoja: string): Promise<string> {
  const base = normalizarSlug(nomeLoja) || 'loja'
  const { data, error } = await admin.from('restaurantes').select('slug').like('slug', `${base}%`)
  if (error) throw error

  const existentes = new Set((data ?? []).map((r) => r.slug as string))
  if (!existentes.has(base)) return base

  let i = 2
  while (existentes.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface PreCadastroInput {
  email: string
  /** Opcionais: pré-preenchem o /cadastro do cliente. */
  nomeLoja?: string
  nome?: string
  telefone?: string
  /** Validade do acesso (ISO). null/ausente = sem validade. */
  acessoExpiraEm?: string | null
}

/**
 * Pré-cadastra um cliente pelo e-mail — cria a conta de autenticação (senha temporária,
 * trocada no primeiro acesso) e a linha pendente em `usuarios`. O cliente completa o
 * restante (senha, nome da loja etc.) em `/cadastro` usando este mesmo e-mail. Desde
 * 2026-10-04 é o ÚNICO jeito de criar conta de loja (o cadastro automático saiu).
 */
export async function convidarLojista(admin: SupabaseClient, entrada: PreCadastroInput): Promise<Resultado & { usuarioId?: string }> {
  const emailNormalizado = entrada.email.trim().toLowerCase()
  if (!EMAIL_REGEX.test(emailNormalizado) || emailNormalizado.length > 254) return { ok: false, error: 'E-mail inválido.' }
  const { data: existente, error: erroBusca } = await admin.from('usuarios').select('id').eq('email', emailNormalizado).limit(1)
  if (erroBusca) return { ok: false, error: 'Não foi possível conferir o e-mail. Tente novamente.' }
  if ((existente ?? []).length > 0) return { ok: false, error: 'Este e-mail já está cadastrado.' }
  const expira = entrada.acessoExpiraEm ? new Date(entrada.acessoExpiraEm) : null
  if (expira && (Number.isNaN(expira.getTime()) || expira.getTime() <= Date.now())) return { ok: false, error: 'A validade precisa ser uma data futura.' }

  const { data, error } = await admin.auth.admin.createUser({
    email: emailNormalizado,
    password: randomUUID(),
    email_confirm: true,
  })
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes('already')) return { ok: false, error: 'Este e-mail já está cadastrado.' }
    return { ok: false, error: 'Não foi possível pré-cadastrar o e-mail. Tente novamente.' }
  }

  const { error: insertError } = await admin.from('usuarios').insert({
    id: data.user.id,
    restaurante_id: null,
    papel: 'dono',
    nome: (entrada.nome ?? '').trim().slice(0, 80),
    email: emailNormalizado,
    telefone: (entrada.telefone ?? '').trim().slice(0, 30),
    nome_loja: (entrada.nomeLoja ?? '').trim().slice(0, 80),
    autorizado: false,
    acesso_expira_em: expira ? expira.toISOString() : null,
  })
  if (insertError) {
    await admin.auth.admin.deleteUser(data.user.id)
    return { ok: false, error: 'Não foi possível salvar o pré-cadastro. Tente novamente.' }
  }

  return { ok: true, usuarioId: data.user.id }
}

/** Remove um pré-cadastro que ainda não completou o primeiro acesso (corrige e-mail digitado errado). */
export async function removerConvitePendente(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin.from('usuarios').select('email, restaurante_id').eq('id', usuarioId).maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) return { ok: false, error: 'Conta não encontrada.' }
  if (isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível remover o acesso do administrador da plataforma.' }
  if (usuario.restaurante_id) return { ok: false, error: 'Esta conta já está ativa e não pode ser removida por aqui.' }

  await admin.from('usuarios').delete().eq('id', usuarioId)
  await admin.auth.admin.deleteUser(usuarioId)
  return { ok: true }
}

/** Mensagem do /cadastro para e-mail sem convite. */
export const MSG_SO_CONVITE = 'Cadastro disponível só por convite. Fale com o suporte.'

export type StatusEmailCadastro = 'autorizado' | 'nao_encontrado' | 'ja_cadastrado'

/**
 * Confere se um e-mail foi pré-autorizado pelo /superadmin e ainda não concluiu o
 * cadastro — usado pela checagem ao vivo do campo de e-mail em /cadastro.
 */
export async function verificarEmailAutorizado(admin: SupabaseClient, email: string): Promise<StatusEmailCadastro> {
  const { data, error } = await admin
    .from('usuarios')
    .select('id, restaurante_id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (error) throw error
  if (!data) return 'nao_encontrado'
  return data.restaurante_id ? 'ja_cadastrado' : 'autorizado'
}

/** Dados que o superadmin deixou no pré-cadastro (só para convite PENDENTE). */
export async function dadosDoPreCadastro(admin: SupabaseClient, email: string): Promise<{ nome: string; nomeLoja: string; telefone: string } | null> {
  const { data, error } = await admin
    .from('usuarios')
    .select('nome, nome_loja, telefone, restaurante_id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (error || !data || data.restaurante_id) return null
  return { nome: data.nome ?? '', nomeLoja: data.nome_loja ?? '', telefone: data.telefone ?? '' }
}

const USUARIO_REGEX = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/

/** Normaliza e valida um nome de usuário de login. Retorna null se inválido. */
export function normalizarUsuario(value: string): string | null {
  const usuario = value.trim().toLowerCase()
  if (!USUARIO_REGEX.test(usuario)) return null
  return usuario
}

/** Checa se o nome de usuário está livre (case-insensitive). */
export async function usuarioDisponivel(admin: SupabaseClient, usuario: string): Promise<boolean> {
  // `.eq` sobre o valor já em minúsculas, e não `.ilike`: no LIKE o `_` é curinga, então
  // "joao_silva" aparecia ocupado por causa de "joaoxsilva". A unicidade real é o índice
  // `lower(usuario)` da 0038, e `normalizarUsuario` já grava em minúsculas.
  const { data, error } = await admin
    .from('usuarios')
    .select('id')
    .eq('usuario', usuario.trim().toLowerCase())
    .limit(1)
  if (error) throw error
  return (data ?? []).length === 0
}

/** Resolve o e-mail de autenticação a partir do nome de usuário (login por usuário). */
export async function buscarEmailPorUsuario(admin: SupabaseClient, usuario: string): Promise<string | null> {
  const { data, error } = await admin
    .from('usuarios')
    .select('email')
    .ilike('usuario', usuario.trim())
    .maybeSingle()
  if (error) throw error
  return data?.email ?? null
}

export interface PrimeiroAcessoInput {
  email: string
  senha: string
  nome: string
  telefone: string
  nomeLoja: string
  usuario: string
}

/**
 * Conclui o primeiro acesso de um cliente pré-cadastrado pelo /superadmin: confere que o
 * e-mail foi pré-cadastrado, define a senha, cria a loja (slug gerado a partir do nome) e
 * libera o acesso com a validade escolhida no pré-cadastro. Sem pré-cadastro, ninguém
 * cria conta (o cadastro automático saiu em 2026-10-04).
 */
export async function completarPrimeiroAcesso(admin: SupabaseClient, input: PrimeiroAcessoInput): Promise<Resultado> {
  const email = input.email.trim().toLowerCase()

  const nomeUsuario = normalizarUsuario(input.usuario)
  if (!nomeUsuario) {
    return { ok: false, error: 'Nome de usuário inválido. Use de 3 a 30 caracteres: letras, números, ponto, hífen ou underline.' }
  }
  if (!(await usuarioDisponivel(admin, nomeUsuario))) {
    return { ok: false, error: 'Este nome de usuário já está em uso. Escolha outro.' }
  }

  const { data: conta, error: contaError } = await admin
    .from('usuarios')
    .select('id, restaurante_id, acesso_expira_em')
    .eq('email', email)
    .maybeSingle()
  if (contaError) throw contaError
  if (!conta) return { ok: false, error: MSG_SO_CONVITE }
  if (conta.restaurante_id) {
    return { ok: false, error: 'Este e-mail já tem cadastro concluído. Faça login.' }
  }

  const usuarioId: string = conta.id
  const acessoExpiraEm: string | null = conta.acesso_expira_em ?? null
  const { error: passwordError } = await admin.auth.admin.updateUserById(usuarioId, { password: input.senha })
  if (passwordError) {
    return { ok: false, error: 'Não foi possível definir a senha. Tente novamente.' }
  }

  const slug = await gerarSlugUnico(admin, input.nomeLoja)

  const { data: restaurante, error: restauranteError } = await admin
    .from('restaurantes')
    .insert({ nome: input.nomeLoja.trim(), slug })
    .select('id')
    .single()
  if (restauranteError || !restaurante) {
    return { ok: false, error: 'Não foi possível criar a loja. Tente novamente.' }
  }

  const { error: updateError } = await admin
    .from('usuarios')
    .update({
      nome: input.nome.trim(),
      telefone: input.telefone.trim(),
      nome_loja: input.nomeLoja.trim(),
      usuario: nomeUsuario,
      restaurante_id: restaurante.id,
      papel: 'dono',
      autorizado: true,
      acesso_expira_em: acessoExpiraEm,
    })
    .eq('id', usuarioId)
  if (updateError) {
    await admin.from('restaurantes').delete().eq('id', restaurante.id)
    return { ok: false, error: 'Não foi possível concluir o cadastro. Tente novamente.' }
  }

  return { ok: true }
}

export interface StatusAcesso {
  autorizado: boolean
  restauranteId: string | null
  acessoExpiraEm: string | null
}

/** Acesso válido = autorizado e (sem validade ou validade no futuro). */
export function acessoValido(status: StatusAcesso): boolean {
  if (!status.autorizado) return false
  if (!status.acessoExpiraEm) return true
  return new Date(status.acessoExpiraEm).getTime() > Date.now()
}

/** Status de autorização da conta logada — consultado pelo /login para liberar (ou não) o acesso ao painel. */
export async function buscarStatusAcesso(admin: SupabaseClient, userId: string): Promise<StatusAcesso | null> {
  const { data, error } = await admin.from('usuarios').select('autorizado, restaurante_id, acesso_expira_em').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { autorizado: data.autorizado, restauranteId: data.restaurante_id, acessoExpiraEm: data.acesso_expira_em }
}

/** Registra o login (horário + contagem total), exibidos no painel /superadmin. */
export async function registrarLogin(admin: SupabaseClient, userId: string): Promise<void> {
  const { data } = await admin.from('usuarios').select('logins_total').eq('id', userId).maybeSingle()
  await admin
    .from('usuarios')
    .update({ ultimo_login_em: new Date().toISOString(), logins_total: (data?.logins_total ?? 0) + 1 })
    .eq('id', userId)
}

/**
 * Libera (ou reativa) o acesso de um lojista. `dias` define acesso temporário —
 * expira automaticamente; null/0 = acesso permanente.
 */
export async function concederAcessoLojista(admin: SupabaseClient, usuarioId: string, dias?: number | null): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin
    .from('usuarios')
    .select('restaurante_id')
    .eq('id', usuarioId)
    .maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) return { ok: false, error: 'Conta não encontrada.' }
  if (!usuario.restaurante_id) return { ok: false, error: 'Esta conta ainda não concluiu o cadastro — não há acesso pra liberar.' }

  const expiraEm = dias && dias > 0 ? new Date(Date.now() + dias * 86_400_000).toISOString() : null
  const { error } = await admin.from('usuarios').update({ autorizado: true, acesso_expira_em: expiraEm }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível liberar o acesso.' }
  return { ok: true }
}

/**
 * Altera a validade do acesso sem precisar revogar antes: `expiraEm` null = sem validade.
 * Vale para a conta ativa (renovar/encurtar) e para o convite pendente (vale a partir do 1º acesso).
 */
export async function alterarValidadeLojista(admin: SupabaseClient, usuarioId: string, expiraEm: string | null): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin.from('usuarios').select('email, papel').eq('id', usuarioId).maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) return { ok: false, error: 'Conta não encontrada.' }
  if (usuario.papel !== 'dono') return { ok: false, error: 'Só a conta principal da loja tem validade.' }
  if (isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível alterar o administrador da plataforma.' }
  if (expiraEm) {
    const t = new Date(expiraEm).getTime()
    if (Number.isNaN(t) || t <= Date.now()) return { ok: false, error: 'A validade precisa ser uma data futura.' }
  }
  const { error } = await admin.from('usuarios').update({ acesso_expira_em: expiraEm }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível alterar a validade.' }
  return { ok: true }
}

/**
 * Exclui DE VEZ um lojista sem acesso: a loja (com cardápio, pedidos etc., via
 * cascade), a linha em `usuarios` e a conta de autenticação. Irreversível — só
 * permitido quando o acesso já está revogado/expirado (ou cadastro pendente).
 */
export async function excluirLojistaCompleto(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin
    .from('usuarios')
    .select('email, restaurante_id, autorizado, acesso_expira_em, papel')
    .eq('id', usuarioId)
    .maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) return { ok: false, error: 'Conta não encontrada.' }
  if (isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível excluir o administrador da plataforma.' }
  if (usuario.papel !== 'dono') return { ok: false, error: 'Só a conta principal da loja pode ser excluída por aqui.' }

  const temAcesso = usuario.autorizado && (!usuario.acesso_expira_em || new Date(usuario.acesso_expira_em).getTime() > Date.now())
  if (temAcesso) return { ok: false, error: 'Revogue o acesso antes de excluir os dados.' }

  await admin.from('usuarios').delete().eq('id', usuarioId)
  if (usuario.restaurante_id) {
    const { error } = await admin.from('restaurantes').delete().eq('id', usuario.restaurante_id)
    if (error) return { ok: false, error: 'A conta foi removida, mas não foi possível excluir a loja. Tente novamente.' }
  }
  await admin.auth.admin.deleteUser(usuarioId)
  return { ok: true }
}

/** Revoga o acesso (mantém o vínculo com a loja e o papel, para facilitar reativar depois). */
export async function revogarAcessoLojista(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin.from('usuarios').select('email, papel').eq('id', usuarioId).maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) return { ok: false, error: 'Conta não encontrada.' }
  if (isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível revogar o acesso do administrador da plataforma.' }
  if (usuario.papel !== 'dono') return { ok: false, error: 'Funcionários são bloqueados na tela Equipe da própria loja.' }

  const { error } = await admin.from('usuarios').update({ autorizado: false, acesso_expira_em: null }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível revogar o acesso.' }
  return { ok: true }
}
