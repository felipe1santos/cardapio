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

export interface ConfigPlataforma {
  /** Quando ligado, qualquer pessoa cria a conta em /cadastro sem autorização manual do e-mail. */
  cadastroAutomatico: boolean
  /** Validade (em dias) do acesso criado pelo cadastro automático. 0 = sem validade. */
  cadastroAutomaticoDias: number
}

export async function buscarConfigPlataforma(admin: SupabaseClient): Promise<ConfigPlataforma> {
  const { data, error } = await admin
    .from('config_plataforma')
    .select('cadastro_automatico, cadastro_automatico_dias')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return {
    cadastroAutomatico: data?.cadastro_automatico ?? false,
    cadastroAutomaticoDias: data?.cadastro_automatico_dias ?? 30,
  }
}

export async function salvarConfigPlataforma(admin: SupabaseClient, config: ConfigPlataforma): Promise<Resultado> {
  const { error } = await admin
    .from('config_plataforma')
    .upsert({ id: 1, cadastro_automatico: config.cadastroAutomatico, cadastro_automatico_dias: Math.max(0, Math.floor(config.cadastroAutomaticoDias)) })
  if (error) return { ok: false, error: 'Não foi possível salvar a configuração.' }
  return { ok: true }
}

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

const USUARIO_REGEX = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])$/

/** Normaliza e valida um nome de usuário de login. Retorna null se inválido. */
export function normalizarUsuario(value: string): string | null {
  const usuario = value.trim().toLowerCase()
  if (!USUARIO_REGEX.test(usuario)) return null
  return usuario
}

/** Checa se o nome de usuário está livre (case-insensitive). */
export async function usuarioDisponivel(admin: SupabaseClient, usuario: string): Promise<boolean> {
  const { data, error } = await admin
    .from('usuarios')
    .select('id')
    .ilike('usuario', usuario.trim())
    .maybeSingle()
  if (error) throw error
  return !data
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
 * libera o acesso.
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
    .select('id, restaurante_id')
    .eq('email', email)
    .maybeSingle()
  if (contaError) throw contaError
  if (conta?.restaurante_id) {
    return { ok: false, error: 'Este e-mail já tem cadastro concluído. Faça login.' }
  }

  let usuarioId: string
  let acessoExpiraEm: string | null = null
  // Conta criada agora pelo cadastro automático — se algo falhar depois, desfaz tudo.
  let criadoAutomaticamente = false

  if (conta) {
    // Fluxo com pré-autorização manual: a conta de auth já existe (senha temporária).
    usuarioId = conta.id
    const { error: passwordError } = await admin.auth.admin.updateUserById(usuarioId, { password: input.senha })
    if (passwordError) {
      return { ok: false, error: 'Não foi possível definir a senha. Tente novamente.' }
    }
  } else {
    // Cadastro automático: sem pré-autorização, cria a conta na hora com a
    // validade configurada no /superadmin.
    const config = await buscarConfigPlataforma(admin)
    if (!config.cadastroAutomatico) {
      return { ok: false, error: 'E-mail não encontrado. Confirme o e-mail com o administrador da plataforma.' }
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: input.senha,
      email_confirm: true,
    })
    if (createError || !created.user) {
      if (createError?.message?.toLowerCase().includes('already')) return { ok: false, error: 'Já existe uma conta com este e-mail. Faça login.' }
      return { ok: false, error: 'Não foi possível criar a conta. Tente novamente.' }
    }

    const { error: insertError } = await admin.from('usuarios').insert({
      id: created.user.id,
      restaurante_id: null,
      papel: 'dono',
      nome: '',
      email,
      telefone: '',
      nome_loja: '',
      autorizado: false,
    })
    if (insertError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return { ok: false, error: 'Não foi possível criar a conta. Tente novamente.' }
    }

    usuarioId = created.user.id
    criadoAutomaticamente = true
    acessoExpiraEm = config.cadastroAutomaticoDias > 0
      ? new Date(Date.now() + config.cadastroAutomaticoDias * 86_400_000).toISOString()
      : null
  }

  async function desfazerContaAutomatica() {
    if (!criadoAutomaticamente) return
    await admin.from('usuarios').delete().eq('id', usuarioId)
    await admin.auth.admin.deleteUser(usuarioId)
  }

  const slug = await gerarSlugUnico(admin, input.nomeLoja)

  const { data: restaurante, error: restauranteError } = await admin
    .from('restaurantes')
    .insert({ nome: input.nomeLoja.trim(), slug })
    .select('id')
    .single()
  if (restauranteError || !restaurante) {
    await desfazerContaAutomatica()
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
    await desfazerContaAutomatica()
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
 * Exclui DE VEZ um lojista sem acesso: a loja (com cardápio, pedidos etc., via
 * cascade), a linha em `usuarios` e a conta de autenticação. Irreversível — só
 * permitido quando o acesso já está revogado/expirado (ou cadastro pendente).
 */
export async function excluirLojistaCompleto(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin
    .from('usuarios')
    .select('email, restaurante_id, autorizado, acesso_expira_em')
    .eq('id', usuarioId)
    .maybeSingle()
  if (usuarioError) throw usuarioError
  if (!usuario) return { ok: false, error: 'Conta não encontrada.' }
  if (isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível excluir o administrador da plataforma.' }

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

export interface LojistaRow {
  id: string
  email: string
  usuario: string
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
  acessoExpiraEm: string | null
  loginsTotal: number
}

interface LojistaRowRaw {
  id: string
  email: string
  usuario: string
  nome: string
  nome_loja: string
  telefone: string
  papel: PapelUsuario
  autorizado: boolean
  restaurante_id: string | null
  ultimo_login_em: string | null
  criado_em: string
  acesso_expira_em: string | null
  logins_total: number | null
  restaurantes: { nome: string; slug: string } | null
}

/** Lista todas as contas (pré-cadastradas ou ativas), com a loja vinculada, para o painel /superadmin. */
export async function listarLojistas(admin: SupabaseClient): Promise<LojistaRow[]> {
  const { data, error } = await admin
    .from('usuarios')
    .select('id, email, usuario, nome, nome_loja, telefone, papel, autorizado, restaurante_id, ultimo_login_em, criado_em, acesso_expira_em, logins_total, restaurantes(nome, slug)')
    // Mais acessados primeiro; empate resolve pelo login mais recente.
    .order('logins_total', { ascending: false })
    .order('ultimo_login_em', { ascending: false, nullsFirst: false })
    .order('criado_em', { ascending: false })
  if (error) throw error

  return (data as unknown as LojistaRowRaw[]).map((row) => ({
    id: row.id,
    email: row.email,
    usuario: row.usuario ?? '',
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
    acessoExpiraEm: row.acesso_expira_em,
    loginsTotal: row.logins_total ?? 0,
  }))
}

export interface MetricasLoja {
  faturamento: number
  qtdPedidos: number
  ticketMedio: number
  pedidosPorDia: number
  ultimoPedidoEm: string | null
}

/**
 * Métricas por loja a partir dos pedidos ENTREGUES (faturamento realizado), para o
 * painel /superadmin. Agrega em memória (poucas lojas no nível da plataforma).
 */
export async function metricasPorRestaurante(admin: SupabaseClient): Promise<Map<string, MetricasLoja>> {
  const { data, error } = await admin
    .from('pedidos')
    .select('restaurante_id, total, criado_em')
    .eq('status', 'entregue')
  if (error) throw error

  const acc = new Map<string, { tot: number; qtd: number; min: number; max: number }>()
  for (const p of (data ?? []) as { restaurante_id: string | null; total: number; criado_em: string }[]) {
    if (!p.restaurante_id) continue
    const t = new Date(p.criado_em).getTime()
    const cur = acc.get(p.restaurante_id) ?? { tot: 0, qtd: 0, min: t, max: t }
    cur.tot += Number(p.total)
    cur.qtd += 1
    cur.min = Math.min(cur.min, t)
    cur.max = Math.max(cur.max, t)
    acc.set(p.restaurante_id, cur)
  }

  const out = new Map<string, MetricasLoja>()
  for (const [id, a] of acc) {
    const dias = Math.max(1, Math.ceil((a.max - a.min) / 86_400_000) + 1)
    out.set(id, {
      faturamento: a.tot,
      qtdPedidos: a.qtd,
      ticketMedio: a.qtd > 0 ? a.tot / a.qtd : 0,
      pedidosPorDia: a.qtd / dias,
      ultimoPedidoEm: new Date(a.max).toISOString(),
    })
  }
  return out
}

/** Revoga o acesso (mantém o vínculo com a loja e o papel, para facilitar reativar depois). */
export async function revogarAcessoLojista(admin: SupabaseClient, usuarioId: string): Promise<Resultado> {
  const { data: usuario, error: usuarioError } = await admin.from('usuarios').select('email').eq('id', usuarioId).maybeSingle()
  if (usuarioError) throw usuarioError
  if (usuario && isSuperAdminEmail(usuario.email)) return { ok: false, error: 'Não é possível revogar o acesso do administrador da plataforma.' }

  const { error } = await admin.from('usuarios').update({ autorizado: false, acesso_expira_em: null }).eq('id', usuarioId)
  if (error) return { ok: false, error: 'Não foi possível revogar o acesso.' }
  return { ok: true }
}
