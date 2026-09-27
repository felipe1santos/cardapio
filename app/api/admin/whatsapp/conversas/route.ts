import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { contarEmAtendimento, listarConversasPainel } from '@/lib/mensageria/conversas'

/**
 * Conversas do robô do WhatsApp no painel (Atendimento): dono e gerente
 * (`whatsapp.atender`), conferido aqui além do middleware. A loja vem SEMPRE da sessão.
 *
 *   GET               → em atendimento humano + atendidas pelo robô nas últimas 24h
 *   GET ?contagem=1   → só o número (selo do menu)
 *   POST { conversaId, acao: 'devolver' | 'pausar' }
 *
 * Devolver/pausar passam pela função do banco com a MESMA trava que o webhook usa, e
 * nenhum dos dois envia mensagem ao cliente.
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'whatsapp.atender')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

const semCache = { 'Cache-Control': 'no-store' }

export async function GET(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  if (new URL(request.url).searchParams.get('contagem') === '1') {
    return NextResponse.json({ emAtendimento: await contarEmAtendimento(ctx.admin, ctx.sessao.restauranteId) }, { headers: semCache })
  }
  return NextResponse.json(await listarConversasPainel(ctx.admin, ctx.sessao.restauranteId), { headers: semCache })
}

export async function POST(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  let corpo: { conversaId?: unknown; acao?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (typeof corpo.conversaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(corpo.conversaId)) {
    return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
  }
  if (corpo.acao !== 'devolver' && corpo.acao !== 'pausar') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const { data, error } = await ctx.admin.rpc('whatsapp_alterar_conversa', {
    p_restaurante: ctx.sessao.restauranteId,
    p_conversa: corpo.conversaId,
    p_acao: corpo.acao,
    p_ator: ctx.sessao.userId,
    p_ator_nome: ctx.sessao.nome,
  })
  if (error) {
    // Conversa de outra loja ou inexistente: a mesma resposta (não vira oráculo).
    if (error.message?.includes('conversa_inexistente')) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
    return NextResponse.json({ error: 'Não foi possível alterar a conversa.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...(data as object) }, { headers: semCache })
}
