import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { definirCozinhaPorFuncao } from '@/lib/impressao/servico'

/** Liga/desliga o roteamento da ficha da cozinha pela função (PUT { ativo }). */
export async function PUT(request: Request) {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (typeof corpo.ativo !== 'boolean') return NextResponse.json({ error: 'Informe ativo: true/false.' }, { status: 400 })
  const r = await definirCozinhaPorFuncao(ctx.admin, ctx.op, corpo.ativo)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}
