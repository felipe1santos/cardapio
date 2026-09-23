import { NextResponse } from 'next/server'
import { contextoLegado } from '@/lib/pdv-legado'
import { pode } from '@/lib/auth/permissoes'
import { ehUuid } from '@/lib/pdv-v2'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import * as conta from '@/lib/servicos/conta-presencial'

/**
 * Cancelar pedido da comanda no PDV ANTIGO (loja sem `pdv_v2`).
 *
 * Antes cancelava qualquer pedido de comanda, em qualquer estado, sem motivo e sem
 * zerar a reimpressão. Agora segue a regra do presencial: motivo obrigatório; o
 * atendente cancela direto só pedido ainda "recebido" numa conta sem pagamento; o
 * resto é da gerência; dinheiro já recebido acima do novo total exige estorno antes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoLegado('cancelar')
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo.trim().slice(0, 200) : ''
  if (!motivo) {
    await ctx.registrar('sem_motivo')
    return NextResponse.json({ error: 'Informe o motivo do cancelamento.', codigo: 'motivo_obrigatorio' }, { status: 400 })
  }

  const eu = { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel }
  const r = await conta.cancelarPedido(ctx.admin, eu, id, motivo, pode(ctx.sessao.papel, 'pedidos.presencial.cancelar'), 'pdv')
  if (!r.ok) {
    await ctx.registrar('recusado', { codigo: r.codigo })
    return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  }
  reverterBeneficiosPedidoCancelado(ctx.admin, eu.restauranteId, id).catch(console.error)
  await ctx.registrar('ok')
  return NextResponse.json({ ok: true })
}
