import { NextResponse } from 'next/server'
import { contextoPresencial } from '@/lib/auth/presencial'
import { sanearItensLancamento } from '@/lib/lancamento-mesa'
import { ehUuid } from '@/lib/pdv-v2'
import { lancar, pagar } from '@/lib/servicos/conta-presencial'
import { controleCaixaAtivo } from '@/lib/financeiro/nivel'
import { chavePagamentoDoLancamento, lerPagamentoPdv } from '@/lib/pdv-pagamento'

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

  const pagamento = lerPagamentoPdv(corpo.pagamento)
  // Cobrar agora com o controle de caixa ativo (nível 2): sem caixa aberto o pagamento seria recusado — avisa
  // ANTES de lançar, para não mandar à cozinha um pedido que o operador acha que já está pago.
  if (pagamento?.cobrarAgora && await controleCaixaAtivo(ctx.admin, ctx.sessao.restauranteId)) {
    const { data: turno } = await ctx.admin.from('caixa_turnos').select('id').eq('restaurante_id', ctx.sessao.restauranteId).is('fechado_em', null).maybeSingle()
    if (!turno) return NextResponse.json({ error: 'O caixa está fechado. Abra o caixa para cobrar agora, ou escolha receber na entrega/retirada.', codigo: 'caixa_fechado' }, { status: 409 })
  }

  const r = await lancar(
    ctx.admin,
    { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel },
    { comandaId, mesaId },
    saneado.itens,
    corpo.chave,
    'pdv',
    pagamento,
  )
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })

  // Cobrar agora (09/10): o pagamento entra junto, pelo mesmo caminho do Receber da conta (livro-caixa no Financeiro).
  // Valor = o que falta na conta; chave derivada da do lançamento (reenvio não cobra duas vezes).
  let cobranca: { ok: true; troco: number } | { ok: false; erro: string } | null = null
  if (pagamento?.cobrarAgora) {
    const { data: tot } = await ctx.admin.rpc('comanda_totais', { p_comanda: r.valor.comandaId })
    const restante = Number((((tot as unknown[] | null) ?? [])[0] as { restante?: number } | undefined)?.restante ?? 0)
    if (restante > 0.004) {
      const p = await pagar(ctx.admin, { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel },
        { id: r.valor.comandaId, tipo: 'balcao', mesaNome: null, numero: null, senha: null, clienteNome: null },
        { forma: pagamento.escolha, valor: restante, recebido: pagamento.escolha === 'dinheiro' && pagamento.trocoPara ? pagamento.trocoPara : null, chave: chavePagamentoDoLancamento(corpo.chave as string), observacao: null },
        ctx.loja.formasPagamento, 'pdv')
      cobranca = p.ok ? { ok: true, troco: p.valor.troco ?? 0 } : { ok: false, erro: p.erro }
    } else cobranca = { ok: true, troco: 0 }
  }
  return NextResponse.json({ ok: true, ...r.valor, cobranca }, { status: r.valor.idempotente ? 200 : 201 })
}
