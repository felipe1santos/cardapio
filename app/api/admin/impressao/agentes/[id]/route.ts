import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { renomearAgente, revogarAgente } from '@/lib/impressao/servico'
import { ehUuid } from '@/lib/pdv-v2'

/** Renomear (PATCH { nome }) ou revogar (POST { acao: "revogar" }) um computador. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Computador inválido' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await renomearAgente(ctx.admin, ctx.op, id, typeof corpo?.nome === 'string' ? corpo.nome : '')
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Computador inválido' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (corpo?.acao !== 'revogar') return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  const r = await revogarAgente(ctx.admin, ctx.op, id)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}
