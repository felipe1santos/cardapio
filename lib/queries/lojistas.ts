import type { SupabaseClient } from '@supabase/supabase-js'

export type PapelUsuario = 'dono' | 'atendente' | 'cozinha' | 'logistica' | 'entregador'

type Resultado = { ok: true } | { ok: false; error: string }

export interface CadastroLojistaInput {
  nomeLoja: string
  nome: string
  telefone: string
  email: string
  senha: string
}

/** Cria a conta de autenticação + o registro pendente em `usuarios` (sem loja vinculada, sem acesso liberado). */
export async function cadastrarLojista(admin: SupabaseClient, input: CadastroLojistaInput): Promise<Resultado> {
  const email = input.email.trim().toLowerCase()

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.senha,
    email_confirm: true,
  })
  if (error || !data.user) {
    if (error?.message?.toLowerCase().includes('already')) return { ok: false, error: 'Já existe uma conta com este e-mail.' }
    return { ok: false, error: 'Não foi possível criar a conta. Tente novamente.' }
  }

  const { error: insertError } = await admin.from('usuarios').insert({
    id: data.user.id,
    restaurante_id: null,
    papel: 'dono',
    nome: input.nome.trim(),
    email,
    telefone: input.telefone.trim(),
    nome_loja: input.nomeLoja.trim(),
    autorizado: false,
  })
  if (insertError) {
    await admin.auth.admin.deleteUser(data.user.id)
    return { ok: false, error: 'Não foi possível salvar o cadastro. Tente novamente.' }
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

/** Lista todas as contas de lojista (autorizadas ou pendentes), com a loja vinculada, para o painel /superadmin. */
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

export interface RestauranteResumo {
  id: string
  nome: string
  slug: string
}

/** Lista as lojas (tenants) existentes, para o seletor de vínculo no /superadmin. */
export async function listarRestaurantes(admin: SupabaseClient): Promise<RestauranteResumo[]> {
  const { data, error } = await admin.from('restaurantes').select('id, nome, slug').order('nome')
  if (error) throw error
  return data ?? []
}

/** Cria uma nova loja (tenant) — usado pelo /superadmin para abrir um slug antes de vincular um lojista. */
export async function criarRestaurante(admin: SupabaseClient, nome: string, slug: string): Promise<Resultado> {
  const { error } = await admin.from('restaurantes').insert({ nome, slug })
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Já existe uma loja com esse slug.' }
    return { ok: false, error: 'Não foi possível criar a loja.' }
  }
  return { ok: true }
}

/** Vincula o lojista a uma loja (papel "dono") e libera o acesso. */
export async function autorizarLojista(admin: SupabaseClient, usuarioId: string, restauranteId: string): Promise<Resultado> {
  const { error } = await admin.from('usuarios').update({ restaurante_id: restauranteId, papel: 'dono', autorizado: true }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível autorizar o acesso.' }
  return { ok: true }
}

/** Revoga o acesso (mantém o vínculo com a loja e o papel, para facilitar reativar depois). */
export async function revogarAcessoLojista(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { error } = await admin.from('usuarios').update({ autorizado: false }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível revogar o acesso.' }
  return { ok: true }
}
