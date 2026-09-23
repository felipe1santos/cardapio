import { NextResponse } from 'next/server'
import { contextoPresencial } from '@/lib/auth/presencial'
import { sanearItensLancamento } from '@/lib/lancamento-mesa'
import { ehUuid } from '@/lib/pdv-v2'
import { lancar } from '@/lib/servicos/conta-presencial'

/**
 * Lançar na cozinha pelo PDV v2 — numa comanda aberta (balcão ou mesa) ou numa mesa
 * livre (a comanda nasce no primeiro lançamento, como no salão).
 *
 * Corpo em lista fechada: `{ comandaId | mesaId, itens[], chave }`. Preço, canal,
 * origem, loja, autor, status, pago e impresso são decididos no servidor; o que vier
 * a mais é ignorado. Pedido e itens nascem juntos numa transação (comanda_lancar), só
 * em comanda aberta — se a conta fechou no meio, a resposta é 409.
 */
export async function POST(request: Request) {
  const ctx = await contextoPresencial('balcao.lancar')
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })

  const comandaId = ehUuid(corpo.comandaId) ? corpo.comandaId : undefined
  const mesaId = ehUuid(corpo.mesaId) ? corpo.mesaId : undefined
  if (!comandaId === !mesaId) return NextResponse.json({ error: 'Informe a conta ou a mesa.' }, { status: 400 })
  if (mesaId && !ctx.loja.moduloMesas) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (!ehUuid(corpo.chave)) return NextResponse.json({ error: 'Chave do lançamento ausente ou inválida.' }, { status: 400 })

  const saneado = sanearItensLancamento(corpo.itens)
  if (!saneado.ok) return NextResponse.json({ error: saneado.erro }, { status: 400 })

  const r = await lancar(
    ctx.admin,
    { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel },
    { comandaId, mesaId },
    saneado.itens,
    corpo.chave,
    'pdv',
  )
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.idempotente ? 200 : 201 })
}
