import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { gerarPareamento } from '@/lib/impressao/servico'

/**
 * Gera um código de pareamento de uso único (10 min) para ligar um computador à loja.
 * O código aparece só nesta resposta; o banco guarda o hash. Só em loja liberada para o
 * piloto do Assistente Beta (0100) — nas outras, 403.
 */
export async function POST() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const r = await gerarPareamento(ctx.admin, ctx.op)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status, headers: semCache })
  return NextResponse.json(r.valor, { status: 201, headers: semCache })
}
