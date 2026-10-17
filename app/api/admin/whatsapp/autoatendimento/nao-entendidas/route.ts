import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { ASSUNTOS, normalizarTexto, type Assunto } from '@/lib/robo-auto/classificador'
import { jaEntende, palavraEhDaLoja, palavrasDaFrase, sugestaoPorRegras, type Sugestao } from '@/lib/robo-auto/aprender'
import { extrasComGlobais } from '@/lib/robo-auto/motor'

/**
 * "Perguntas que o robô não entendeu" (refeito em 16/10/2026): o dono revisa uma frase por vez.
 *   GET   → as que faltam revisar (30 dias), com a sugestão automática e o contexto. Antes, reprocessa: o que o robô já
 *           entende (palavras novas da loja ou globais) sai da lista sozinho.
 *   POST  { id, acao: 'robo', assunto, palavras[1–3] }  → palavra-chave do assunto (genérica vira sugestão no Super Admin)
 *         { id, acao: 'ia', resposta }                   → conhecimento da loja (o Agente de IA usa; nunca compartilhado)
 *         { id, acao: 'pedido' }                          → pedido escrito parecido vai direto para o Agente de IA
 *         { id, acao: 'ignorar' }
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

interface Linha { id: string; texto: string; exemplo: string | null; vezes: number; ultima_em: string; contexto: string | null; sugestao: Sugestao | null }

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const desde = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
  const [{ data }, { data: cfg }] = await Promise.all([
    admin.from('whatsapp_auto_nao_entendidas').select('id, texto, exemplo, vezes, ultima_em, contexto, sugestao')
      .eq('restaurante_id', sessao.restauranteId).is('acao', null).gte('ultima_em', desde).order('vezes', { ascending: false }).order('ultima_em', { ascending: false }).limit(200),
    admin.from('whatsapp_robo_config').select('auto_palavras').eq('restaurante_id', sessao.restauranteId).maybeSingle(),
  ])
  const extras = await extrasComGlobais(admin, { auto_palavras: (cfg?.auto_palavras as Record<string, string[]> | null) ?? null })
  const linhas = (data ?? []) as Linha[]
  const entende = linhas.filter((l) => jaEntende(l.exemplo || l.texto, extras))
  if (entende.length) {
    await admin.from('whatsapp_auto_nao_entendidas').update({ acao: 'ja_entende', resolvido_em: new Date().toISOString(), resolvido_por: 'reprocessado' })
      .in('id', entende.map((l) => l.id)).eq('restaurante_id', sessao.restauranteId)
  }
  const ficam = linhas.filter((l) => !entende.includes(l))
  const semSugestao = ficam.filter((l) => !l.sugestao)
  for (const l of semSugestao) {
    l.sugestao = sugestaoPorRegras(l.exemplo || l.texto, extras)
    await admin.from('whatsapp_auto_nao_entendidas').update({ sugestao: l.sugestao }).eq('id', l.id).eq('restaurante_id', sessao.restauranteId)
  }
  return NextResponse.json({
    total: ficam.length,
    reprocessadas: entende.length,
    itens: ficam.map((l) => ({ ...l, palavras: palavrasDaFrase(l.exemplo || l.texto) })),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const corpo = (await request.json().catch(() => null)) as { id?: unknown; acao?: unknown; assunto?: unknown; palavras?: unknown; resposta?: unknown } | null
  if (typeof corpo?.id !== 'string' || !['robo', 'ia', 'pedido', 'ignorar'].includes(String(corpo.acao))) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const acao = String(corpo.acao) as 'robo' | 'ia' | 'pedido' | 'ignorar'
  const { data: item } = await admin.from('whatsapp_auto_nao_entendidas').select('id, texto, exemplo').eq('id', corpo.id).eq('restaurante_id', sessao.restauranteId).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 })
  const frase = String(item.exemplo || item.texto)

  if (acao === 'robo' || acao === 'pedido') {
    const { data: cfg } = await admin.from('whatsapp_robo_config').select('auto_palavras').eq('restaurante_id', sessao.restauranteId).maybeSingle()
    const palavras = { ...((cfg?.auto_palavras as Record<string, string[]> | null) ?? {}) }
    if (acao === 'robo') {
      const assunto = corpo.assunto as Assunto
      const escolhidas = Array.isArray(corpo.palavras) ? [...new Set(corpo.palavras.map((p) => normalizarTexto(String(p))).filter((p) => p.length >= 2))] : []
      if (!(ASSUNTOS as unknown[]).includes(assunto) || escolhidas.length < 1 || escolhidas.length > 3) return NextResponse.json({ error: 'Escolha o assunto e de 1 a 3 palavras.' }, { status: 400 })
      const lista = new Set(palavras[assunto] ?? [])
      for (const p of escolhidas) lista.add(p.slice(0, 60))
      if (lista.size > 100) return NextResponse.json({ error: 'Esse assunto já tem 100 palavras extras.' }, { status: 400 })
      palavras[assunto] = [...lista]
      // Palavra genérica vira sugestão para todas as lojas (o Super Admin aprova). Produto e bairro ficam só na loja.
      const [{ data: itens }, { data: bairros }] = await Promise.all([
        admin.from('itens_cardapio').select('nome').eq('restaurante_id', sessao.restauranteId).limit(1000),
        admin.from('taxas_entrega_bairro').select('bairro').eq('restaurante_id', sessao.restauranteId).limit(1000),
      ])
      const nomes = ((itens ?? []) as { nome: string }[]).map((i) => i.nome)
      const nomesBairros = ((bairros ?? []) as { bairro: string }[]).map((b) => b.bairro)
      for (const p of escolhidas.filter((x) => !palavraEhDaLoja(x, nomes, nomesBairros))) {
        const { data: ja } = await admin.from('robo_palavras_globais').select('id, vezes').eq('palavra', p).eq('assunto', assunto).maybeSingle()
        if (ja) await admin.from('robo_palavras_globais').update({ vezes: Number(ja.vezes) + 1 }).eq('id', ja.id)
        else await admin.from('robo_palavras_globais').insert({ palavra: p, assunto, origem_restaurante_id: sessao.restauranteId })
      }
    } else {
      const chave = palavrasDaFrase(frase).join(' ')
      if (!chave) return NextResponse.json({ error: 'Essa frase não tem palavras para reconhecer.' }, { status: 400 })
      palavras.pedir = [...new Set([...(palavras.pedir ?? []), chave.slice(0, 120)])].slice(-100)
    }
    const { error } = await admin.from('whatsapp_robo_config').update({ auto_palavras: palavras }).eq('restaurante_id', sessao.restauranteId)
    if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }
  if (acao === 'ia') {
    const resposta = typeof corpo.resposta === 'string' ? corpo.resposta.trim() : ''
    if (resposta.length < 2 || resposta.length > 600) return NextResponse.json({ error: 'Escreva a resposta certa (até 600 letras).' }, { status: 400 })
    const { error } = await admin.from('ia_conhecimento').insert({ restaurante_id: sessao.restauranteId, pergunta: frase.slice(0, 300), resposta, criado_por_nome: sessao.nome })
    if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }
  await admin.from('whatsapp_auto_nao_entendidas').update({
    acao, resolvido_em: new Date().toISOString(), resolvido_por: sessao.nome,
    ...(acao === 'robo' ? { ensinado_assunto: String(corpo.assunto) } : {}),
  }).eq('id', item.id).eq('restaurante_id', sessao.restauranteId)
  return NextResponse.json({ ok: true })
}
