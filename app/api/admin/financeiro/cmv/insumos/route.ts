import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { lerEntradaInsumo, listarInsumos, salvarInsumo } from '@/lib/financeiro/cmv'

/** Insumos da loja (GET: custos_ver) e cadastro (POST: custos_editar). */
export async function GET() {
  const c = await contextoFinanceiro('custos_ver')
  if ('erro' in c) return c.erro
  return NextResponse.json({ insumos: await listarInsumos(c.admin, c.sessao.restauranteId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro('custos_editar')
  if ('erro' in c) return c.erro
  const r = await salvarInsumo(c, null, lerEntradaInsumo(await request.json().catch(() => null)))
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true, id: r.valor.id }, { status: 201 })
}
