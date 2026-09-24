import { NextResponse } from 'next/server'
import { contextoPresencial } from '@/lib/auth/presencial'
import { sanearAberturaBalcao } from '@/lib/pdv-v2'
import { abrirBalcao, listarCentralBalcao } from '@/lib/servicos/conta-presencial'

/**
 * Central de Balcão (PDV v2).
 *
 * GET  — comandas de balcão: `?escopo=abertas` (padrão) ou `?escopo=hoje` (fechadas e
 *        canceladas hoje, para reabrir ou conferir).
 * POST — abre um atendimento do card preto: `{ nome, telefone?, chave, entrega? }`. A
 *        chave torna o duplo clique inofensivo. Telefone informado vincula (ou cria) o
 *        cadastro DESTA loja em `clientes`. Com `entrega` (endereço + taxa opcional) vira
 *        entrega manual: origem PDV, tipo entrega, cozinha de sempre e depois logística.
 *        Origem, canal e tipo são do servidor.
 *
 * Loja e operador vêm da sessão. Loja sem `pdv_v2` recebe 404.
 */

export async function GET(request: Request) {
  const ctx = await contextoPresencial('balcao.abrir')
  if ('erro' in ctx) return ctx.erro
  const escopo = new URL(request.url).searchParams.get('escopo') === 'hoje' ? 'hoje' : 'abertas'
  try {
    const dados = await listarCentralBalcao(ctx.admin, ctx.sessao.restauranteId, escopo)
    return NextResponse.json(dados, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[balcao] listar:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Não foi possível carregar o balcão.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const ctx = await contextoPresencial('balcao.abrir')
  if ('erro' in ctx) return ctx.erro
  const corpo = await request.json().catch(() => null)
  const s = sanearAberturaBalcao(corpo)
  if (!s.ok) return NextResponse.json({ error: s.erro }, { status: 400 })

  const r = await abrirBalcao(ctx.admin, { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel }, s, 'pdv')
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.idempotente ? 200 : 201 })
}
