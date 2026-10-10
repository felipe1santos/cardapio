import { NextResponse } from 'next/server'
import { contextoAtendimento, ehId, semCache } from '../../atendimento/contexto'

/**
 * Alerta "Cliente pedindo atendente" do Painel de Pedidos (robô de autoatendimento, 0177).
 *   GET                       → conversas aguardando atendente pedidas ao robô nas últimas 12 h (nome e número)
 *   POST { conversaId }       → "Reativar robô nesta conversa" (mesma ação "retomar" da central)
 * Só lojas com o autoatendimento ligado têm alerta (as outras recebem lista vazia).
 */
export async function GET() {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const { data: cfg } = await ctx.admin.from('whatsapp_robo_config').select('autoatendimento_ativo').eq('restaurante_id', ctx.loja).maybeSingle()
  if (cfg?.autoatendimento_ativo !== true) return NextResponse.json({ itens: [] }, { headers: semCache })
  const { data } = await ctx.admin
    .from('whatsapp_conversas')
    .select('id, telefone, nome_contato, silenciada_em')
    .eq('restaurante_id', ctx.loja)
    .eq('estado', 'silenciada')
    .eq('silenciada_motivo', 'cliente')
    .eq('atendimento', 'aguardando')
    .gte('silenciada_em', new Date(Date.now() - 12 * 3600_000).toISOString())
    .order('silenciada_em', { ascending: false })
    .limit(10)
  const itens = ((data ?? []) as { id: string; telefone: string; nome_contato: string | null; silenciada_em: string }[])
    .map((c) => ({ id: c.id, nome: c.nome_contato, telefone: c.telefone, desde: c.silenciada_em }))
  return NextResponse.json({ itens }, { headers: semCache })
}

export async function POST(request: Request) {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { conversaId?: unknown } | null
  const id = corpo?.conversaId
  if (typeof id !== 'string' || !ehId(id)) return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
  const { error } = await ctx.admin.rpc('whatsapp_atendimento_acao', {
    p_restaurante: ctx.loja, p_conversa: id, p_acao: 'retomar', p_ator: ctx.sessao.userId, p_ator_nome: ctx.sessao.nome, p_robo_ativo: true,
  })
  if (error) {
    if (error.message?.includes('conversa_inexistente')) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
    return NextResponse.json({ error: 'Não foi possível reativar.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { headers: semCache })
}
