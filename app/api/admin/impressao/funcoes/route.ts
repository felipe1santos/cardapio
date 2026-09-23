import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { atribuirFuncao, ehFuncao } from '@/lib/impressao/servico'
import { ehUuid } from '@/lib/pdv-v2'

/**
 * Atribui a função Cozinha ou Caixa a uma impressora (ou tira: `dispositivoId: null`).
 * A mesma impressora nas duas só com `confirmarCompartilhada: true`.
 */
export async function PUT(request: Request) {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!ehFuncao(corpo.funcao)) return NextResponse.json({ error: 'Função inválida' }, { status: 400 })
  const dispositivoId = corpo.dispositivoId === null ? null : ehUuid(corpo.dispositivoId) ? corpo.dispositivoId : undefined
  if (dispositivoId === undefined) return NextResponse.json({ error: 'Impressora inválida' }, { status: 400 })
  const r = await atribuirFuncao(ctx.admin, ctx.op, corpo.funcao, dispositivoId, corpo.confirmarCompartilhada === true)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}
