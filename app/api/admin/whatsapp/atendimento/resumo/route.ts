import { NextResponse } from 'next/server'
import { contextoAtendimento, semCache } from '../contexto'
import { resumoCentral } from '@/lib/mensageria/atendimento'

/** Número do botão flutuante (fechado): conversas aguardando + não lidas. Leve. */
export async function GET() {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  try {
    return NextResponse.json(await resumoCentral(ctx.admin, ctx.loja), { headers: semCache })
  } catch {
    return NextResponse.json({ error: 'Central indisponível' }, { status: 503, headers: semCache })
  }
}
