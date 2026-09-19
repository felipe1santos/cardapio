import { NextResponse } from 'next/server'
import { contextoSalao } from '@/lib/auth/salao'
import { registrarAuditoria } from '@/lib/auditoria'
import {
  MESA_MENSAGEM_PADRAO,
  carrosselValido,
  mensagemValida,
  ordemValida,
} from '@/lib/mesa-vitrine'

/**
 * Personalização do cardápio da mesa (QR): carrossel do topo, texto do aviso da seleção
 * e ordem das categorias (0074). Só a gestão (`mesas.gerenciar`). Loja vem da sessão, nunca do corpo.
 *
 * As colunas (0073) são lidas e escritas só aqui e na página pública da mesa — nada disso
 * entra no select compartilhado do cardápio, então o delivery não depende delas.
 */

export async function GET() {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro
  const loja = ctx.sessao.restauranteId

  const [{ data: r, error: e1 }, { data: categorias, error: e2 }] = await Promise.all([
    ctx.admin.from('restaurantes').select('mesa_carrossel_urls, mesa_mensagem_selecao').eq('id', loja).maybeSingle(),
    ctx.admin.from('grupos_cardapio').select('id, posicao_mesa').eq('restaurante_id', loja),
  ])
  if (e1 || e2) return NextResponse.json({ error: 'Não foi possível carregar.' }, { status: 500 })

  return NextResponse.json({
    carrossel: (r?.mesa_carrossel_urls as string[] | null) ?? [],
    mensagem: (r?.mesa_mensagem_selecao as string | null) ?? null,
    mensagemPadrao: MESA_MENSAGEM_PADRAO,
    // Posição de cada CATEGORIA no cardápio da mesa.
    posicoes: Object.fromEntries(((categorias ?? []) as { id: string; posicao_mesa: number | null }[]).map((i) => [i.id, i.posicao_mesa])),
  })
}

export async function PUT(request: Request) {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro
  const loja = ctx.sessao.restauranteId

  let corpo: { carrossel?: unknown; mensagem?: unknown; ordem?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  const resumo: string[] = []

  if (corpo.carrossel !== undefined) {
    const c = carrosselValido(corpo.carrossel, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', restauranteId: loja })
    if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 400 })
    patch.mesa_carrossel_urls = c.urls
    resumo.push(`carrossel com ${c.urls.length} imagem(ns)`)
  }

  if (corpo.mensagem !== undefined) {
    const m = mensagemValida(corpo.mensagem)
    if (!m.ok) return NextResponse.json({ error: m.erro }, { status: 400 })
    patch.mesa_mensagem_selecao = m.texto
    resumo.push(m.texto ? 'mensagem personalizada' : 'mensagem padrão')
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await ctx.admin.from('restaurantes').update(patch).eq('id', loja)
    if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  }

  if (corpo.ordem !== undefined) {
    const { data: ids, error } = await ctx.admin.from('grupos_cardapio').select('id').eq('restaurante_id', loja)
    if (error) return NextResponse.json({ error: 'Não foi possível salvar a ordem.' }, { status: 500 })
    const o = ordemValida(corpo.ordem, new Set(((ids ?? []) as { id: string }[]).map((i) => i.id)))
    if (!o.ok) return NextResponse.json({ error: o.erro }, { status: 400 })
    // Um update por categoria, sempre preso à loja. São poucas: sem gargalo.
    const falhas = (
      await Promise.all(
        o.posicoes.map(({ id, posicao }) =>
          ctx.admin.from('grupos_cardapio').update({ posicao_mesa: posicao }).eq('id', id).eq('restaurante_id', loja),
        ),
      )
    ).filter((r) => r.error)
    if (falhas.length > 0) return NextResponse.json({ error: 'Parte da ordem não foi salva. Tente de novo.' }, { status: 500 })
    resumo.push(`ordem de ${o.posicoes.length} categoria(s)`)
  }

  if (resumo.length === 0) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })

  await registrarAuditoria(ctx.admin, {
    restauranteId: loja,
    usuarioId: ctx.sessao.userId,
    usuarioNome: ctx.sessao.nome,
    acao: 'mesas.configurou_cardapio',
    entidade: 'restaurante',
    entidadeId: loja,
    dados: { resumo: resumo.join(' · ') },
  })
  return NextResponse.json({ ok: true })
}
