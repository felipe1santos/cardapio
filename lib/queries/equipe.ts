import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarUsuario, usuarioDisponivel } from './lojistas'
import { papeisQuePodeGerenciar, pode, type Papel } from '@/lib/auth/permissoes'

/**
 * Equipe do estabelecimento.
 *
 * Tudo roda com `service_role`: a 0062 tirou de `authenticated` o INSERT/UPDATE em
 * `usuarios` e o SELECT de e-mail, telefone e autorização. Quem chama estas funções é
 * uma rota de servidor que já conferiu `equipe.gerenciar` — e as travas de quem pode
 * mexer em quem (própria conta, nível igual ou superior, último administrador) estão em
 * `podeAdministrar`, conferidas pela rota antes de chegar aqui.
 */

export interface Funcionario {
  id: string
  nome: string
  usuario: string
  papel: Papel
  ativo: boolean
  ultimoLoginEm: string | null
  criadoEm: string
}

export const SENHA_MINIMA = 8

/** Mensagens de validação do cadastro. Vazio = pode criar. Regra pura. */
export function validarNovoFuncionario(
  entrada: { nome: string; usuario: string; papel: string; senha: string },
  papelDoAtor: string,
): string[] {
  const erros: string[] = []
  if (entrada.nome.trim().length < 2) erros.push('Informe o nome do funcionário.')
  if (entrada.nome.trim().length > 80) erros.push('Nome muito longo.')
  if (!normalizarUsuario(entrada.usuario)) {
    erros.push('Login inválido. Use de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.')
  }
  if (!(papeisQuePodeGerenciar(papelDoAtor) as string[]).includes(entrada.papel)) {
    erros.push('Você não pode criar um funcionário com esse papel.')
  }
  erros.push(...validarSenha(entrada.senha))
  return erros
}

export function validarSenha(senha: string): string[] {
  if (senha.length < SENHA_MINIMA) return [`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`]
  if (senha.length > 72) return ['Senha muito longa.']
  return []
}

/**
 * E-mail técnico da conta. O Supabase Auth exige e-mail, mas garçom entra com login e
 * senha. Domínio `.local` não resolve e não recebe nada: a conta é criada já confirmada,
 * sem disparar mensagem nenhuma.
 */
export function emailTecnico(usuario: string, restauranteId: string): string {
  return `${usuario}.${restauranteId.slice(0, 8)}@equipe.menuzia.local`
}

interface UsuarioRow {
  id: string
  nome: string
  usuario: string
  papel: Papel
  desativado_em: string | null
  ultimo_login_em: string | null
  criado_em: string
}

export async function listarEquipe(admin: SupabaseClient, restauranteId: string): Promise<Funcionario[]> {
  const { data, error } = await admin
    .from('usuarios')
    .select('id, nome, usuario, papel, desativado_em, ultimo_login_em, criado_em')
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as UsuarioRow[]).map((u) => ({
    id: u.id,
    nome: u.nome,
    usuario: u.usuario,
    papel: u.papel,
    ativo: !u.desativado_em,
    ultimoLoginEm: u.ultimo_login_em,
    criadoEm: u.criado_em,
  }))
}

/** Quantos OUTROS usuários ativos têm `equipe.gerenciar` — a trava do último administrador. */
export async function contarOutrosAdminsAtivos(
  admin: SupabaseClient,
  restauranteId: string,
  excetoId: string,
): Promise<number> {
  const equipe = await listarEquipe(admin, restauranteId)
  return equipe.filter((f) => f.id !== excetoId && f.ativo && pode(f.papel, 'equipe.gerenciar')).length
}

export type Resultado<T = void> = { ok: true; valor: T } | { ok: false; erro: string }

export async function criarFuncionario(
  admin: SupabaseClient,
  entrada: { restauranteId: string; nome: string; usuario: string; papel: Papel; senha: string; criadoPor: string },
): Promise<Resultado<Funcionario>> {
  const usuario = normalizarUsuario(entrada.usuario)
  if (!usuario) return { ok: false, erro: 'Login inválido.' }
  if (!(await usuarioDisponivel(admin, usuario))) return { ok: false, erro: 'Esse login já está em uso.' }

  const { data: criado, error: erroAuth } = await admin.auth.admin.createUser({
    email: emailTecnico(usuario, entrada.restauranteId),
    password: entrada.senha,
    email_confirm: true,
  })
  if (erroAuth || !criado.user) {
    return { ok: false, erro: 'Não foi possível criar a conta. Tente outro login.' }
  }

  const { data, error } = await admin
    .from('usuarios')
    .insert({
      id: criado.user.id,
      restaurante_id: entrada.restauranteId,
      papel: entrada.papel,
      nome: entrada.nome.trim(),
      email: emailTecnico(usuario, entrada.restauranteId),
      usuario,
      autorizado: true,
      criado_por: entrada.criadoPor,
    })
    .select('id, nome, usuario, papel, desativado_em, ultimo_login_em, criado_em')
    .single()

  if (error) {
    // Sem a linha em `usuarios` a conta do Auth fica solta e inútil: desfaz.
    await admin.auth.admin.deleteUser(criado.user.id).catch(() => {})
    // Duas criações simultâneas com o mesmo login: o índice único da 0038 decide.
    if (error.code === '23505') return { ok: false, erro: 'Esse login já está em uso.' }
    return { ok: false, erro: 'Não foi possível salvar o funcionário.' }
  }

  const u = data as UsuarioRow
  return {
    ok: true,
    valor: { id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel, ativo: true, ultimoLoginEm: null, criadoEm: u.criado_em },
  }
}

export async function buscarFuncionario(
  admin: SupabaseClient,
  restauranteId: string,
  id: string,
): Promise<Funcionario | null> {
  const equipe = await listarEquipe(admin, restauranteId)
  return equipe.find((f) => f.id === id) ?? null
}

/**
 * Ativa ou desativa. Desativar NÃO apaga: login, histórico e os pedidos que a pessoa
 * lançou continuam. O acesso cai na requisição seguinte, porque o middleware e a RLS
 * releem `desativado_em` do banco a cada chamada.
 */
export async function definirAtivo(admin: SupabaseClient, restauranteId: string, id: string, ativo: boolean): Promise<void> {
  const { error } = await admin
    .from('usuarios')
    .update({ desativado_em: ativo ? null : new Date().toISOString() })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
  if (error) throw error
}

export async function atualizarNomeEPapel(
  admin: SupabaseClient,
  restauranteId: string,
  id: string,
  patch: { nome?: string; papel?: Papel },
): Promise<void> {
  const row: Record<string, string> = {}
  if (patch.nome !== undefined) row.nome = patch.nome.trim()
  if (patch.papel !== undefined) row.papel = patch.papel
  if (Object.keys(row).length === 0) return
  const { error } = await admin.from('usuarios').update(row).eq('id', id).eq('restaurante_id', restauranteId)
  if (error) throw error
}

export async function redefinirSenha(admin: SupabaseClient, id: string, senha: string): Promise<Resultado> {
  const { error } = await admin.auth.admin.updateUserById(id, { password: senha })
  if (error) return { ok: false, erro: 'Não foi possível redefinir a senha.' }
  return { ok: true, valor: undefined }
}
