import { NextResponse } from 'next/server'
import { contextoPresencial } from '@/lib/auth/presencial'
import { ehUuid } from '@/lib/pdv-v2'
import { criarPreConta, ultimasPreContas } from '@/lib/impressao/servico'

/**
 * Pré-conta da comanda (mesa ou balcão): conferência de consumo para o cliente.
 *
 * O navegador manda SÓ `{ chave, reimpressao }`. Itens, valores, taxa, desconto, pago,
 * restante, impressora e número da via são decididos no banco
 * (impressao_pre_conta_criar), com a comanda travada. Não mexe em pedido, pagamento,
 * atendimento, cozinha nem na conta — é um documento, não uma operação.
 */

async function contexto(id: string) {
  const ctx = await contextoPresencial('comanda.pre_conta')
  if ('erro' in ctx) return ctx
  if (!ehUuid(id)) return { erro: NextResponse.json({ error: 'Conta inválida' }, { status: 400 }) }
  const { data: c } = await ctx.admin.from('comandas').select('id, tipo').eq('id', id).eq('restaurante_id', ctx.sessao.restauranteId).maybeSingle()
  if (!c) return { erro: NextResponse.json({ error: 'Conta não encontrada nesta loja' }, { status: 404 }) }
  if (c.tipo === 'mesa' && !ctx.loja.moduloMesas) return { erro: NextResponse.json({ error: 'Não encontrado' }, { status: 404 }) }
  return ctx
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contexto(id)
  if ('erro' in ctx) return ctx.erro
  return NextResponse.json({ vias: await ultimasPreContas(ctx.admin, ctx.sessao.restauranteId, id) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contexto(id)
  if ('erro' in ctx) return ctx.erro
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!ehUuid(corpo.chave)) return NextResponse.json({ error: 'Operação sem identificador. Recarregue a tela.' }, { status: 400 })
  const r = await criarPreConta(
    ctx.admin,
    { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome },
    id,
    corpo.chave,
    corpo.reimpressao === true,
  )
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.idempotente ? 200 : 201 })
}
