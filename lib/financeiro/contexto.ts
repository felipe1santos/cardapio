import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession, type AppSession } from '@/lib/auth/session'
import { normalizarAcessos, type Acessos } from '@/lib/acessos'
import { podeFin, type AcaoFin } from './permissoes'

/**
 * Contexto de toda rota do financeiro (0132). Quem é, de que loja, se o módulo está ligado e
 * se pode a ação — tudo do SERVIDOR (sessão + banco). O corpo da requisição nunca diz quem é
 * o usuário, a loja ou o valor calculado.
 */
export interface ContextoFin {
  sessao: AppSession
  admin: SupabaseClient
  acessos: Acessos | null
  /** "Chrome · Windows · 189.x.x.x · terminal ab12…" — vai em cada lançamento. */
  dispositivo: string
  ip: string | null
  terminal: string | null
}

export const COOKIE_TERMINAL = 'menuzia_terminal'

export async function dispositivoDaRequisicao(): Promise<{ dispositivo: string; ip: string | null; terminal: string | null; agente: string }> {
  const h = await headers()
  const c = await cookies()
  const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim() || null
  const agente = (h.get('user-agent') ?? '').slice(0, 250)
  const terminal = c.get(COOKIE_TERMINAL)?.value?.slice(0, 80) ?? null
  const nav = /Edg\//.test(agente) ? 'Edge' : /Chrome\//.test(agente) ? 'Chrome' : /Firefox\//.test(agente) ? 'Firefox' : /Safari\//.test(agente) ? 'Safari' : 'Navegador'
  const so = /Android/.test(agente) ? 'Android' : /iPhone|iPad/.test(agente) ? 'iOS' : /Windows/.test(agente) ? 'Windows' : /Mac OS/.test(agente) ? 'macOS' : /Linux/.test(agente) ? 'Linux' : ''
  const dispositivo = [nav, so, ip, terminal ? `terminal ${terminal.slice(0, 8)}` : null].filter(Boolean).join(' · ').slice(0, 200)
  return { dispositivo, ip, terminal, agente }
}

/** A sessão deste terminal está travada (0132)? Sem terminal não há trava a conferir. */
export async function telaTravada(admin: SupabaseClient, usuarioId: string, terminal: string | null): Promise<boolean> {
  if (!terminal) return false
  const { data } = await admin.from('usuarios_sessoes').select('id').eq('usuario_id', usuarioId).eq('terminal', terminal)
    .is('encerrada_em', null).not('bloqueada_em', 'is', null).limit(1)
  return !!data?.length
}

/**
 * Exige: logado, loja com o módulo financeiro ligado e (se informada) a permissão da ação.
 * Devolve o contexto ou a resposta de erro pronta.
 */
export async function contextoFinanceiro(acao?: AcaoFin): Promise<ContextoFin | { erro: NextResponse }> {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const [{ data: loja }, { data: usu }] = await Promise.all([
    admin.from('restaurantes').select('financeiro_ativo').eq('id', sessao.restauranteId).maybeSingle(),
    admin.from('usuarios').select('acessos').eq('id', sessao.userId).maybeSingle(),
  ])
  if (!loja?.financeiro_ativo) {
    return { erro: NextResponse.json({ error: 'O módulo financeiro não está ativo nesta loja.', codigo: 'financeiro_inativo' }, { status: 404 }) }
  }
  const acessos = normalizarAcessos((usu as { acessos?: unknown } | null)?.acessos)
  if (acao && !podeFin(sessao.papel, acessos, acao)) {
    return { erro: NextResponse.json({ error: 'Você não tem permissão para esta ação.', codigo: 'sem_permissao_acao', acao }, { status: 403 }) }
  }
  const d = await dispositivoDaRequisicao()
  if (await telaTravada(admin, sessao.userId, d.terminal)) {
    return { erro: NextResponse.json({ error: 'Tela bloqueada. Destrave com o seu PIN.', codigo: 'tela_bloqueada' }, { status: 423 }) }
  }
  return { sessao, admin, acessos, dispositivo: d.dispositivo, ip: d.ip, terminal: d.terminal }
}
