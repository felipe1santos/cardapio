import { NextResponse } from 'next/server'
import { contextoPresencial } from '@/lib/auth/presencial'
import { ehUuid } from '@/lib/pdv-v2'
import { daPedido, ESCOLHAS_PDV } from '@/lib/pdv-pagamento'

/**
 * Bloco "Pagamento" do PDV (0135): o que a tela precisa para escolher a forma e o troco antes de
 * lançar. GET ?comandaId= → tipo da conta, entrega, total atual da conta, taxa de entrega que o
 * primeiro lançamento ainda vai somar, a forma já escolhida (pré-preenche) e as formas aceitas.
 * Quem decide é o servidor no lançamento (comanda_lancar confere o troco contra o total).
 */
export async function GET(request: Request) {
  const ctx = await contextoPresencial('balcao.lancar')
  if ('erro' in ctx) return ctx.erro
  const comandaId = new URL(request.url).searchParams.get('comandaId')
  if (!ehUuid(comandaId)) return NextResponse.json({ error: 'Conta inválida.' }, { status: 400 })
  const loja = ctx.sessao.restauranteId
  const { data: c } = await ctx.admin.from('comandas').select('id, tipo, status, entrega, taxa_entrega').eq('id', comandaId).eq('restaurante_id', loja).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  const [{ data: tot }, { data: peds }] = await Promise.all([
    ctx.admin.rpc('comanda_totais', { p_comanda: comandaId }),
    ctx.admin.from('pedidos').select('forma_pagamento, cartao_tipo, troco_para, criado_em').eq('comanda_id', comandaId).neq('status', 'cancelado').order('criado_em', { ascending: false }).limit(1),
  ])
  const t = ((tot as unknown[] | null) ?? [])[0] as { total?: number } | undefined
  const ultimo = peds?.[0]
  const aceitas = ctx.loja.formasPagamento as string[]
  return NextResponse.json({
    tipo: c.tipo,
    entrega: !!c.entrega,
    totalAtual: Number(t?.total ?? 0),
    taxaPendente: c.entrega && !ultimo ? Number(c.taxa_entrega ?? 0) : 0,
    atual: ultimo ? daPedido(ultimo.forma_pagamento as string, ultimo.cartao_tipo as string | null, ultimo.troco_para === null ? null : Number(ultimo.troco_para)) : null,
    formas: ESCOLHAS_PDV.filter((f) => aceitas.includes(f) || (f === 'pix' && aceitas.includes('pix'))),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
