import { NextResponse } from 'next/server'
import { contextoLegado } from '@/lib/pdv-legado'
import { ehUuid } from '@/lib/pdv-v2'
import * as conta from '@/lib/servicos/conta-presencial'

/**
 * "Fechar conta" do PDV ANTIGO (loja sem `pdv_v2`).
 *
 * Antes fazia `update comandas set status='fechada'` direto, sem conferir saldo nem
 * registrar quem fechou. Agora passa pela mesma função de fechamento do salão: exige
 * saldo zero (pagamentos registrados), nenhum cancelamento pendente, grava autor e
 * total final, e trava a comanda contra lançamento simultâneo.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoLegado('fechar')
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Conta inválida' }, { status: 400 })

  const eu = { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel }
  const c = await conta.buscarConta(ctx.admin, eu.restauranteId, id)
  if (!c) return NextResponse.json({ error: 'Conta não encontrada' }, { status: 404 })

  const r = await conta.fechar(ctx.admin, eu, c, 'pdv')
  if (!r.ok) {
    await ctx.registrar('recusado', { codigo: r.codigo })
    return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  }
  await ctx.registrar('ok')
  return NextResponse.json({ ok: true })
}
