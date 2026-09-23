import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { painelImpressao } from '@/lib/impressao/servico'

/** Computadores, impressoras, funções e últimos trabalhos da loja da sessão. */
export async function GET() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  return NextResponse.json(await painelImpressao(ctx.admin, ctx.op.restauranteId), { headers: semCache })
}
