import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'

/**
 * Conhecimento da loja (16/10/2026): respostas que o dono ensinou ("Fazem suco?" → "Não, só refrigerante e água"). O Agente
 * de IA usa em qualquer forma de pergunta. É só da loja (nunca compartilhado). Módulo Agente de IA (o middleware confere).
 *   GET · POST { pergunta, resposta } · PATCH { id, pergunta, resposta } · DELETE { id }
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

function campos(c: { pergunta?: unknown; resposta?: unknown } | null) {
  const pergunta = typeof c?.pergunta === 'string' ? c.pergunta.trim() : ''
  const resposta = typeof c?.resposta === 'string' ? c.resposta.trim() : ''
  return pergunta.length >= 2 && pergunta.length <= 300 && resposta.length >= 2 && resposta.length <= 600 ? { pergunta, resposta } : null
}

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { data } = await ctx.admin.from('ia_conhecimento').select('id, pergunta, resposta, atualizado_em').eq('restaurante_id', ctx.sessao.restauranteId).order('criado_em').limit(200)
  return NextResponse.json({ itens: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const c = campos(await request.json().catch(() => null))
  if (!c) return NextResponse.json({ error: 'Pergunta e resposta (até 300 e 600 letras).' }, { status: 400 })
  const { count } = await ctx.admin.from('ia_conhecimento').select('id', { count: 'exact', head: true }).eq('restaurante_id', ctx.sessao.restauranteId)
  if ((count ?? 0) >= 200) return NextResponse.json({ error: 'Limite de 200 respostas.' }, { status: 400 })
  const { error } = await ctx.admin.from('ia_conhecimento').insert({ restaurante_id: ctx.sessao.restauranteId, ...c, criado_por_nome: ctx.sessao.nome })
  return error ? NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 }) : NextResponse.json({ ok: true })
}

export async function PATCH(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { id?: unknown; pergunta?: unknown; resposta?: unknown } | null
  const c = campos(corpo)
  if (typeof corpo?.id !== 'string' || !c) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const { error } = await ctx.admin.from('ia_conhecimento').update({ ...c, atualizado_em: new Date().toISOString() }).eq('id', corpo.id).eq('restaurante_id', ctx.sessao.restauranteId)
  return error ? NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 }) : NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { id?: unknown } | null
  if (typeof corpo?.id !== 'string') return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const { error } = await ctx.admin.from('ia_conhecimento').delete().eq('id', corpo.id).eq('restaurante_id', ctx.sessao.restauranteId)
  return error ? NextResponse.json({ error: 'Não foi possível apagar.' }, { status: 500 }) : NextResponse.json({ ok: true })
}
