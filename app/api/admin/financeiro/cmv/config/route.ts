import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { salvarConfig } from '@/lib/financeiro/cmv'
import type { Arredondamento } from '@/lib/financeiro/cmv-regras'

/** Margem-alvo (loja e por categoria), margem baixa, % de custos variáveis e arredondamento. PUT: custos_editar. */
export async function PUT(request: Request) {
  const c = await contextoFinanceiro('custos_editar')
  if ('erro' in c) return c.erro
  const b = await request.json().catch(() => null)
  const porCategoria: Record<string, number | null> = {}
  if (b?.porCategoria && typeof b.porCategoria === 'object') for (const [k, v] of Object.entries(b.porCategoria)) porCategoria[k] = v === null || v === '' ? null : Number(v)
  const r = await salvarConfig(c, {
    margemAlvoPct: Number(b?.margemAlvoPct), margemBaixaPct: Number(b?.margemBaixaPct), custosVariaveisPct: Number(b?.custosVariaveisPct ?? 0),
    arredondamento: String(b?.arredondamento ?? '90') as Arredondamento, porCategoria,
  })
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}
