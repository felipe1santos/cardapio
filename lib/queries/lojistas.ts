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

/**
 * Pré-cadastra um cliente pelo e-mail — cria a conta de autenticação (senha temporária,
 * trocada no primeiro acesso) e a linha pendente em `usuarios`. O cliente completa o
 * restante (senha, nome da loja etc.) em `/cadastro` usando este mesmo e-mail.
 */
export async function convidarLojista(admin: SupabaseClient, email: string): Promise<Resultado> {
  const emailNormalizado = email.trim().toLowerCase()

  const { data, error } = await admin.auth.admin.createUser({
    email: emailNormalizado,
    password: randomUUID(),
    email_confirm: true,
  })
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes('already')) return { ok: false, error: 'Já existe uma conta com este e-mail.' }
    return { ok: false, error: 'Não foi possível pré-cadastrar o e-mail. Tente novamente.' }
  }

  const { error: insertError } = await admin.from('usuarios').insert({
    id: data.user.id,
    restaurante_id: null,
    papel: 'dono',
    nome: '',
    email: emailNormalizado,
    telefone: '',
    nome_loja: '',
    autorizado: false,
  })
  if (insertError) {
    await admin.auth.admin.deleteUser(data.user.id)
    return { ok: false, error: 'Não foi possível salvar o pré-cadastro. Tente novamente.' }
  }

  return { ok: true }
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

export interface PrimeiroAcessoInput {
  email: string
  senha: string
  nome: string
  telefone: string
  nomeLoja: string
}

/**
 * Conclui o primeiro acesso de um cliente pré-cadastrado pelo /superadmin: confere que o
 * e-mail foi pré-cadastrado, define a senha, cria a loja (slug gerado a partir do nome) e
 * libera o acesso.
 */
export async function completarPrimeiroAcesso(admin: SupabaseClient, input: PrimeiroAcessoInput): Promise<Resultado> {
  const email = input.email.trim().toLowerCase()

  const { data: usuario, error: usuarioError } = await admin
    .from('usuarios')
    .select('id, restaurante_id')
    .eq('email', email)
    .maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) {
    return { ok: false, error: 'E-mail não encontrado. Confirme o e-mail com o administrador da plataforma.' }
  }
  if (usuario.restaurante_id) {
    return { ok: false, error: 'Este e-mail já tem cadastro concluído. Faça login.' }
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

  const { error: passwordError } = await admin.auth.admin.updateUserById(usuario.id, { password: input.senha })
  if (passwordError) {
    await admin.from('restaurantes').delete().eq('id', restaurante.id)
    return { ok: false, error: 'Não foi possível definir a senha. Tente novamente.' }
  }

  const { error: updateError } = await admin
    .from('usuarios')
    .update({
      nome: input.nome.trim(),
      telefone: input.telefone.trim(),
      nome_loja: input.nomeLoja.trim(),
      restaurante_id: restaurante.id,
      papel: 'dono',
      autorizado: true,
    })
    .eq('id', usuario.id)
  if (updateError) {
    await admin.from('restaurantes').delete().eq('id', restaurante.id)
    return { ok: false, error: 'Não foi possível concluir o cadastro. Tente novamente.' }
  }

  return { ok: true }
}

export interface StatusAcesso {
  autorizado: boolean
  restauranteId: string | null
}

/** Status de autorização da conta logada — consultado pelo /login para liberar (ou não) o acesso ao painel. */
export async function buscarStatusAcesso(admin: SupabaseClient, userId: string): Promise<StatusAcesso | null> {
  const { data, error } = await admin.from('usuarios').select('autorizado, restaurante_id').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { autorizado: data.autorizado, restauranteId: data.restaurante_id }
}

/** Registra o horário do login mais recente, exibido no painel /superadmin. */
export async function registrarLogin(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('usuarios').update({ ultimo_login_em: new Date().toISOString() }).eq('id', userId)
}

export interface LojistaRow {
  id: string
  email: string
  nome: string
  nomeLoja: string
  telefone: string
  papel: PapelUsuario
  autorizado: boolean
  restauranteId: string | null
  restauranteNome: string | null
  restauranteSlug: string | null
  ultimoLoginEm: string | null
  criadoEm: string
}

interface LojistaRowRaw {
  id: string
  email: string
  nome: string
  nome_loja: string
  telefone: string
  papel: PapelUsuario
  autorizado: boolean
  restaurante_id: string | null
  ultimo_login_em: string | null
  criado_em: string
  restaurantes: { nome: string; slug: string } | null
}

/** Lista todas as contas (pré-cadastradas ou ativas), com a loja vinculada, para o painel /superadmin. */
export async function listarLojistas(admin: SupabaseClient): Promise<LojistaRow[]> {
  const { data, error } = await admin
    .from('usuarios')
    .select('id, email, nome, nome_loja, telefone, papel, autorizado, restaurante_id, ultimo_login_em, criado_em, restaurantes(nome, slug)')
    .order('criado_em', { ascending: false })
  if (error) throw error

  return (data as unknown as LojistaRowRaw[]).map((row) => ({
    id: row.id,
    email: row.email,
    nome: row.nome,
    nomeLoja: row.nome_loja,
    telefone: row.telefone,
    papel: row.papel,
    autorizado: row.autorizado,
    restauranteId: row.restaurante_id,
    restauranteNome: row.restaurantes?.nome ?? null,
    restauranteSlug: row.restaurantes?.slug ?? null,
    ultimoLoginEm: row.ultimo_login_em,
    criadoEm: row.criado_em,
  }))
}

/** Revoga o acesso (mantém o vínculo com a loja e o papel, para facilitar reativar depois). */
export async function revogarAcessoLojista(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin.from('usuarios').select('email').eq('id', usuarioId).maybeSingle()
  if (usuarioError) throw usuarioError
  if (usuario && isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível revogar o acesso do administrador da plataforma.' }

  const { error } = await admin.from('usuarios').update({ autorizado: false }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível revogar o acesso.' }
  return { ok: true }
}
