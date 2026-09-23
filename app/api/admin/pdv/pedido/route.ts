import { NextResponse } from 'next/server'
import { criarPedido, type NovoPedidoInput } from '@/lib/queries/pedidos'
import { abrirOuObterComanda } from '@/lib/queries/comandas'
import { sanearItensLancamento } from '@/lib/lancamento-mesa'
import { contextoLegado } from '@/lib/pdv-legado'
import { ehUuid } from '@/lib/pdv-v2'

/**
 * Lançamento do PDV ANTIGO (loja sem `pdv_v2`). Mantido durante a convivência, agora
 * com corpo em lista fechada: só `mesaId`, `cliente.nome` e `itens` são lidos. Antes o
 * corpo inteiro era espalhado (`...rest`) no pedido e só alguns campos eram sobrescritos.
 */
export async function POST(request: Request) {
  const ctx = await contextoLegado('pedido')
  if ('erro' in ctx) return ctx.erro

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })

  const saneado = sanearItensLancamento(corpo.itens)
  if (!saneado.ok) {
    await ctx.registrar('corpo_invalido')
    return NextResponse.json({ error: saneado.erro }, { status: 400 })
  }
  const mesaId = ehUuid(corpo.mesaId) ? corpo.mesaId : undefined
  const clienteBruto = corpo.cliente && typeof corpo.cliente === 'object' ? (corpo.cliente as Record<string, unknown>).nome : ''
  const nome = typeof clienteBruto === 'string' ? clienteBruto.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  const mesaNome = typeof corpo.mesa === 'string' ? corpo.mesa.trim().slice(0, 60) : undefined

  try {
    // Mesa selecionada → agrupa numa comanda (find-or-create). Balcão fica avulso.
    let comandaId: string | undefined
    if (mesaId) {
      const { comanda } = await abrirOuObterComanda(ctx.admin, ctx.sessao.restauranteId, mesaId)
      comandaId = comanda.id
    }

    const input: NovoPedidoInput = {
      tipo: 'retirada',
      cliente: { nome: nome || mesaNome || 'Cliente Balcão', telefone: '' },
      endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
      pagamento: 'dinheiro',
      trocoPara: null,
      itens: saneado.itens,
      origem: 'pdv',
      mesa: mesaId ? mesaNome : undefined,
      comandaId,
      criadoPor: ctx.sessao.userId,
      criadoPorNome: ctx.sessao.nome,
    }

    const pedido = await criarPedido(ctx.admin, ctx.sessao.restauranteId, input)
    await ctx.registrar('ok', { canal: comandaId ? 'mesa' : 'balcao', numero: pedido.numero })
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    await ctx.registrar('erro')
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
