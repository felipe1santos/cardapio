import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { cancelarCompra, lerEntradaCompra, listarCompras, registrarCompra } from '@/lib/financeiro/contas'

/**
 * Compras de insumos (Fase 5b). GET: contas_pagar. POST (registrar): contas_lancar — pagar na hora (caixa ou
 * empresa) exige também contas_marcar_pago. PATCH {id, motivo} cancela (contas_lancar).
 */
export async function GET() {
  const c = await contextoFinanceiro('contas_pagar')
  if ('erro' in c) return c.erro
  return NextResponse.json({ compras: await listarCompras(c.admin, c.sessao.restauranteId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro('contas_lancar')
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ap = b?.aprovacao as { aprovadorId?: unknown; pin?: unknown; remotaId?: unknown } | undefined
  const r = await registrarCompra(c, lerEntradaCompra(b), String(b?.chave ?? ''), ap ? { aprovadorId: String(ap.aprovadorId ?? ''), pin: String(ap.pin ?? ''), remotaId: typeof ap.remotaId === 'string' ? ap.remotaId : null } : null)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo, ...r.dados }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.repetido ? 200 : 201 })
}

export async function PATCH(request: Request) {
  const c = await contextoFinanceiro('contas_lancar')
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await cancelarCompra(c, String(b?.id ?? ''), String(b?.motivo ?? ''))
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}
