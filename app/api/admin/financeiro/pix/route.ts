import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { conferirPix, pixAConferir } from '@/lib/financeiro/motoboy'

/**
 * Conferir Pix (Fase 3). Pix nunca é confirmado pela palavra de quem recebeu: só quem tem a
 * permissão "Conferir Pix" marca que caiu (ou que não caiu, com motivo — vira "a receber").
 *   GET                                         → Pix a conferir
 *   POST { lancamentoId, caiu: boolean, motivo? }
 */
export async function GET() {
  const c = await contextoFinanceiro('pix_conferir')
  if ('erro' in c) return c.erro
  return NextResponse.json({ pix: await pixAConferir(c.admin, c.sessao.restauranteId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro('pix_conferir')
  if ('erro' in c) return c.erro
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = corpo?.lancamentoId
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return NextResponse.json({ error: 'Pix inválido.' }, { status: 400 })
  const r = await conferirPix(c, { lancamentoId: id, caiu: corpo?.caiu === true, motivo: typeof corpo?.motivo === 'string' ? corpo.motivo.slice(0, 300) : null })
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json(r)
}
