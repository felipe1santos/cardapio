import { NextResponse } from 'next/server'
import { contextoSalao } from '@/lib/auth/salao'
import { registrarAuditoria } from '@/lib/auditoria'
import {
  mensagemPadraoDaMesa,
  carrosselValido,
  mensagemValida,
} from '@/lib/mesa-vitrine'

/**
 * Personalização do cardápio da mesa (QR): carrossel do topo, texto do aviso da seleção e
 * modo. A ordem das categorias NÃO é mais daqui: é a do Gestor de Cardápio em todos os
 * canais (0101); `ordem` no corpo é recusada antes de gravar qualquer coisa. Só a gestão
 * (`mesas.gerenciar`). Loja vem da sessão, nunca do corpo.
 *
 * As colunas (0073) são lidas e escritas só aqui e na página pública da mesa — nada disso
 * entra no select compartilhado do cardápio, então o delivery não depende delas.
 */

export async function GET() {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro
  const loja = ctx.sessao.restauranteId

  const { data: r, error: e1 } = await ctx.admin.from('restaurantes').select('mesa_carrossel_urls, mesa_mensagem_selecao, mesa_somente_visualizacao').eq('id', loja).maybeSingle()
  if (e1) return NextResponse.json({ error: 'Não foi possível carregar.' }, { status: 500 })

  return NextResponse.json({
    carrossel: (r?.mesa_carrossel_urls as string[] | null) ?? [],
    mensagem: (r?.mesa_mensagem_selecao as string | null) ?? null,
    mensagemPadrao: mensagemPadraoDaMesa((r?.mesa_somente_visualizacao as boolean | null) === true),
    somenteVisualizacao: (r?.mesa_somente_visualizacao as boolean | null) === true,
  })
}

export async function PUT(request: Request) {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro
  const loja = ctx.sessao.restauranteId

  let corpo: { carrossel?: unknown; mensagem?: unknown; ordem?: unknown; somenteVisualizacao?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  if (corpo.ordem !== undefined) {
    return NextResponse.json({ error: 'A ordem das categorias e dos itens é definida em Cardápio.' }, { status: 400 })
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

  if (corpo.somenteVisualizacao !== undefined) {
    if (typeof corpo.somenteVisualizacao !== 'boolean') return NextResponse.json({ error: 'Modo inválido.' }, { status: 400 })
    patch.mesa_somente_visualizacao = corpo.somenteVisualizacao
    resumo.push(corpo.somenteVisualizacao ? 'modo somente visualização ligado' : 'modo somente visualização desligado')
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await ctx.admin.from('restaurantes').update(patch).eq('id', loja)
    if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
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
