import { NextResponse } from 'next/server'
import { contextoLegado } from '@/lib/pdv-legado'
import { marcarComandaPaga } from '@/lib/queries/comandas'
import { ehUuid } from '@/lib/pdv-v2'
import * as conta from '@/lib/servicos/conta-presencial'

/**
 * "Receber" do PDV ANTIGO (loja sem `pdv_v2`).
 *
 * Antes marcava `pedidos.pago = true` sem registrar dinheiro nenhum. Agora registra o
 * pagamento de verdade — o que falta pagar, na forma escolhida, com operador, canal e
 * origem — e só depois mantém o `pago` de compatibilidade que a tela antiga lê.
 * Sem forma, recusa: inventar "dinheiro" seria gravar um dado falso.
 */
const FORMAS = ['dinheiro', 'pix', 'credito', 'debito']

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoLegado('pagar')
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Conta inválida' }, { status: 400 })

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const forma = corpo?.forma
  if (typeof forma !== 'string' || !FORMAS.includes(forma)) {
    await ctx.registrar('sem_forma')
    return NextResponse.json({ error: 'Escolha a forma de pagamento. Se a tela não mostra as formas, recarregue a página.' }, { status: 400 })
  }

  const eu = { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel }
  const c = await conta.buscarConta(ctx.admin, eu.restauranteId, id)
  if (!c) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })

  if (c.totais.restante > 0) {
    const recebido = forma === 'dinheiro' && corpo?.recebido !== undefined && corpo?.recebido !== null && corpo?.recebido !== '' ? Number(corpo.recebido) : null
    const r = await conta.pagar(
      ctx.admin,
      eu,
      c,
      { forma, valor: c.totais.restante, recebido: recebido !== null && recebido >= c.totais.restante ? recebido : null, chave: crypto.randomUUID(), observacao: null },
      FORMAS,
      'pdv',
    )
    if (!r.ok) {
      await ctx.registrar('erro', { codigo: r.codigo })
      return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    }
  }

  await marcarComandaPaga(ctx.admin, eu.restauranteId, id)
  await ctx.registrar('ok', { forma })
  return NextResponse.json({ ok: true })
}
