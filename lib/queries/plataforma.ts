import type { SupabaseClient } from '@supabase/supabase-js'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { sanearDados } from '@/lib/auditoria'

/**
 * Painel da plataforma (/superadmin), 2026-10-04: UMA LINHA POR LOJA.
 *
 * A lista antiga saía de `usuarios` linha a linha, então os logins da equipe de cada loja
 * (garçom, atendente…, e-mail `…@equipe.menuzia.local`) apareciam como "clientes" com "—"
 * no nome da loja e inflavam "Cadastros" e "Ativos". Agora:
 *  - conta principal = o dono da loja (papel 'dono'; se houver mais de um, o com acesso e mais antigo);
 *  - os demais logins da loja são SUBLOGINS (só leitura aqui; a gestão é na tela Equipe da loja);
 *  - pré-cadastro (dono sem loja ainda) é uma linha própria, "Aguardando 1º acesso".
 */

export type SituacaoLoja = 'pendente' | 'ativo' | 'ativo_temporario' | 'expirado' | 'revogado'
export type StatusSublogin = 'ativo' | 'pausado' | 'bloqueado'

export interface Sublogin {
  id: string
  nome: string
  login: string
  papel: string
  cargo: string | null
  status: StatusSublogin
  ultimoLoginEm: string | null
  criadoEm: string
}

export interface LojaPlataforma {
  /** Chave estável da linha: id da loja, ou `pre:<id do usuário>` no pré-cadastro. */
  chave: string
  contaId: string
  restauranteId: string | null
  loja: string
  slug: string | null
  responsavel: string
  telefone: string
  email: string
  login: string
  situacao: SituacaoLoja
  acessoExpiraEm: string | null
  criadoEm: string
  ultimoLoginEm: string | null
  loginsTotal: number
  faturamento: number
  pedidos: number
  ticket: number
  betaLiberado: boolean
  sublogins: Sublogin[]
}

export interface ResumoPlataforma {
  cadastros: number
  ativos: number
  pendentes: number
  semAcesso: number
  faturamento: number
  pedidos: number
  ticket: number
}

interface UsuarioRaw {
  id: string
  email: string
  usuario: string | null
  nome: string
  nome_loja: string | null
  telefone: string | null
  papel: string
  cargo: string | null
  autorizado: boolean
  restaurante_id: string | null
  ultimo_login_em: string | null
  criado_em: string
  acesso_expira_em: string | null
  logins_total: number | null
  desativado_em: string | null
  situacao: string | null
}

export function situacaoDaConta(c: { restauranteId: string | null; autorizado: boolean; acessoExpiraEm: string | null }, agora = Date.now()): SituacaoLoja {
  if (!c.restauranteId) return 'pendente'
  if (!c.autorizado) return 'revogado'
  if (!c.acessoExpiraEm) return 'ativo'
  return new Date(c.acessoExpiraEm).getTime() > agora ? 'ativo_temporario' : 'expirado'
}

export function statusDoSublogin(u: { desativado_em: string | null; situacao: string | null }): StatusSublogin | null {
  if (!u.desativado_em) return 'ativo'
  if (u.situacao === 'excluido') return null // excluído pela loja: não conta mais
  return u.situacao === 'pausado' ? 'pausado' : 'bloqueado'
}

/** Escolhe a conta principal entre os donos da loja: com acesso primeiro, depois a mais antiga. */
function principal(donos: UsuarioRaw[]): UsuarioRaw {
  return [...donos].sort((a, b) => Number(b.autorizado) - Number(a.autorizado) || a.criado_em.localeCompare(b.criado_em))[0]
}

/** Agrupa contas por loja (função pura — testada em plataforma.test.ts). */
export function agruparPorLoja(
  usuarios: UsuarioRaw[],
  restaurantes: { id: string; nome: string; slug: string; impressao_beta_liberado?: boolean | null }[],
  metricas: Map<string, { faturamento: number; qtdPedidos: number }>,
  agora = Date.now(),
): LojaPlataforma[] {
  const porLoja = new Map<string, UsuarioRaw[]>()
  const pendentes: UsuarioRaw[] = []
  for (const u of usuarios) {
    if (isSuperAdminEmail(u.email) && !u.restaurante_id) continue
    if (!u.restaurante_id) {
      if (u.papel === 'dono') pendentes.push(u)
      continue
    }
    porLoja.set(u.restaurante_id, [...(porLoja.get(u.restaurante_id) ?? []), u])
  }

  const linhas: LojaPlataforma[] = []
  for (const r of restaurantes) {
    const contas = porLoja.get(r.id) ?? []
    const donos = contas.filter((u) => u.papel === 'dono')
    if (donos.length === 0) continue // loja sem dono não tem conta para gerir aqui
    const dono = principal(donos)
    const m = metricas.get(r.id)
    const sublogins: Sublogin[] = []
    for (const u of contas) {
      if (u.id === dono.id) continue
      const status = statusDoSublogin(u)
      if (!status) continue
      sublogins.push({ id: u.id, nome: u.nome || u.usuario || '—', login: u.usuario ?? '', papel: u.papel, cargo: u.cargo, status, ultimoLoginEm: u.ultimo_login_em, criadoEm: u.criado_em })
    }
    sublogins.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    linhas.push({
      chave: r.id,
      contaId: dono.id,
      restauranteId: r.id,
      loja: r.nome || dono.nome_loja || '—',
      slug: r.slug,
      responsavel: dono.nome ?? '',
      telefone: dono.telefone ?? '',
      email: dono.email,
      login: dono.usuario ?? '',
      situacao: situacaoDaConta({ restauranteId: r.id, autorizado: dono.autorizado, acessoExpiraEm: dono.acesso_expira_em }, agora),
      acessoExpiraEm: dono.acesso_expira_em,
      criadoEm: dono.criado_em,
      ultimoLoginEm: dono.ultimo_login_em,
      loginsTotal: dono.logins_total ?? 0,
      faturamento: m?.faturamento ?? 0,
      pedidos: m?.qtdPedidos ?? 0,
      ticket: m && m.qtdPedidos > 0 ? m.faturamento / m.qtdPedidos : 0,
      betaLiberado: !!r.impressao_beta_liberado,
      sublogins,
    })
  }
  for (const u of pendentes) {
    linhas.push({
      chave: `pre:${u.id}`,
      contaId: u.id,
      restauranteId: null,
      loja: u.nome_loja || '',
      slug: null,
      responsavel: u.nome ?? '',
      telefone: u.telefone ?? '',
      email: u.email,
      login: '',
      situacao: 'pendente',
      acessoExpiraEm: u.acesso_expira_em,
      criadoEm: u.criado_em,
      ultimoLoginEm: null,
      loginsTotal: 0,
      faturamento: 0,
      pedidos: 0,
      ticket: 0,
      betaLiberado: false,
      sublogins: [],
    })
  }
  return linhas
}

/** Números do topo: contam SÓ LOJAS (contas principais e pré-cadastros); valores somados por loja. */
export function resumir(linhas: LojaPlataforma[]): ResumoPlataforma {
  const faturamento = linhas.reduce((s, l) => s + l.faturamento, 0)
  const pedidos = linhas.reduce((s, l) => s + l.pedidos, 0)
  return {
    cadastros: linhas.length,
    ativos: linhas.filter((l) => l.situacao === 'ativo' || l.situacao === 'ativo_temporario').length,
    pendentes: linhas.filter((l) => l.situacao === 'pendente').length,
    semAcesso: linhas.filter((l) => l.situacao === 'revogado' || l.situacao === 'expirado').length,
    faturamento,
    pedidos,
    ticket: pedidos > 0 ? faturamento / pedidos : 0,
  }
}

/**
 * Faturamento e pedidos ENTREGUES por loja. Paginado: o PostgREST devolve no máximo 1000 linhas
 * por consulta, e a soma antiga parava calada nesse teto.
 */
export async function metricasEntreguesPorLoja(admin: SupabaseClient): Promise<Map<string, { faturamento: number; qtdPedidos: number }>> {
  const out = new Map<string, { faturamento: number; qtdPedidos: number }>()
  const PAGINA = 1000
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin.from('pedidos').select('id, restaurante_id, total').eq('status', 'entregue').order('id').range(de, de + PAGINA - 1)
    if (error) throw error
    for (const p of (data ?? []) as { restaurante_id: string | null; total: number }[]) {
      if (!p.restaurante_id) continue
      const cur = out.get(p.restaurante_id) ?? { faturamento: 0, qtdPedidos: 0 }
      cur.faturamento += Number(p.total)
      cur.qtdPedidos += 1
      out.set(p.restaurante_id, cur)
    }
    if (!data || data.length < PAGINA) break
  }
  return out
}

export async function listarLojasPlataforma(admin: SupabaseClient, agora = Date.now()): Promise<{ lojas: LojaPlataforma[]; resumo: ResumoPlataforma }> {
  const [us, rs, metricas] = await Promise.all([
    admin.from('usuarios').select('id, email, usuario, nome, nome_loja, telefone, papel, cargo, autorizado, restaurante_id, ultimo_login_em, criado_em, acesso_expira_em, logins_total, desativado_em, situacao'),
    admin.from('restaurantes').select('id, nome, slug, impressao_beta_liberado'),
    metricasEntreguesPorLoja(admin),
  ])
  if (us.error) throw us.error
  if (rs.error) throw rs.error
  const lojas = agruparPorLoja((us.data ?? []) as UsuarioRaw[], (rs.data ?? []) as { id: string; nome: string; slug: string; impressao_beta_liberado: boolean | null }[], metricas, agora)
  return { lojas, resumo: resumir(lojas) }
}

/** Registro na auditoria da plataforma (0139). Nunca derruba a ação: falha só vai para o log. */
export async function auditarPlataforma(admin: SupabaseClient, ev: { ator: string; acao: string; restauranteId?: string | null; usuarioId?: string | null; alvo?: string | null; dados?: Record<string, unknown> }) {
  const { error } = await admin.from('auditoria_plataforma').insert({
    ator_email: ev.ator.slice(0, 254),
    acao: ev.acao,
    restaurante_id: ev.restauranteId ?? null,
    usuario_id: ev.usuarioId ?? null,
    alvo: ev.alvo ? ev.alvo.slice(0, 200) : null,
    dados: sanearDados(ev.dados ?? {}),
  })
  if (error) console.error('[auditoria-plataforma] falha ao registrar', ev.acao, error.message)
}
