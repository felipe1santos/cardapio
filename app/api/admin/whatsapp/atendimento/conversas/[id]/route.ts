import { NextResponse } from 'next/server'
import { contextoAtendimento, ehId, semCache } from '../../contexto'
import { buscarConversa, pedidosDoCliente, roboDaLojaAtivo } from '@/lib/mensageria/atendimento'
import { buscarFidelidadeCliente } from '@/lib/queries/fidelidade'

/**
 * Uma conversa da central.
 *   GET  → conversa, últimos pedidos e fidelidade do cliente, e se o robô da loja está ativo
 *   POST { acao: 'assumir' | 'encerrar' | 'pausar' | 'retomar' | 'lida' }
 * Conversa de outra loja ou inexistente: 404 (a mesma resposta — não vira oráculo).
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  if (!ehId(id)) return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
  const conversa = await buscarConversa(ctx.admin, ctx.loja, id)
  if (!conversa) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
  const [pedidos, fidelidade, roboAtivo] = await Promise.all([
    pedidosDoCliente(ctx.admin, ctx.loja, conversa.telefone).catch(() => []),
    buscarFidelidadeCliente(ctx.admin, ctx.loja, conversa.telefone)
      .then((f) => f.campanhas.map((c) => ({ nome: c.campanha.nome, faltaTexto: c.resumo.faltaTexto, percentual: c.resumo.percentual })))
      .catch(() => []),
    roboDaLojaAtivo(ctx.admin, ctx.loja),
  ])
  return NextResponse.json({ conversa, pedidos, fidelidade, roboAtivo }, { headers: semCache })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  if (!ehId(id)) return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as { acao?: unknown } | null
  const acao = corpo?.acao
  if (acao !== 'assumir' && acao !== 'encerrar' && acao !== 'pausar' && acao !== 'retomar' && acao !== 'lida') {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  }
  const { data, error } = await ctx.admin.rpc('whatsapp_atendimento_acao', {
    p_restaurante: ctx.loja,
    p_conversa: id,
    p_acao: acao,
    p_ator: ctx.sessao.userId,
    p_ator_nome: ctx.sessao.nome,
    p_robo_ativo: await roboDaLojaAtivo(ctx.admin, ctx.loja),
  })
  if (error) {
    if (error.message?.includes('conversa_inexistente')) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
    return NextResponse.json({ error: 'Não foi possível alterar a conversa.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...(data as object) }, { headers: semCache })
}
