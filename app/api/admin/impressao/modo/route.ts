import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { definirModo } from '@/lib/impressao/servico'

/**
 * O que o Assistente Beta imprime (PUT { modo: "teste" | "caixa" | "cozinha_caixa" }).
 * Troca atômica e auditada no banco (0100). Voltar para "teste" devolve a cozinha ao
 * Assistente antigo na hora — é o botão de emergência do piloto.
 */
export async function PUT(request: Request) {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const r = await definirModo(ctx.admin, ctx.op, corpo.modo)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor })
}
