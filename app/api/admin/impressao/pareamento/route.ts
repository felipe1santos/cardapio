import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { gerarPareamento } from '@/lib/impressao/servico'

/**
 * Gera um código de pareamento de uso único (10 min) para ligar um computador à loja.
 * O código aparece só nesta resposta; o banco guarda o hash.
 */
export async function POST() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const r = await gerarPareamento(ctx.admin, ctx.op)
  return NextResponse.json(r, { status: 201, headers: semCache })
}
