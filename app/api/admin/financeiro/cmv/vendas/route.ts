import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { cmvDoPeriodo } from '@/lib/financeiro/cmv'
import { lerFiltros } from '@/lib/financeiro/fluxo-regras'

/** CMV REAL do período, com o custo GUARDADO em cada venda (nunca o custo atual). GET ?de&ate (custos_ver). */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('custos_ver')
  if ('erro' in c) return c.erro
  const f = lerFiltros(new URL(request.url).searchParams)
  return NextResponse.json({ de: f.de, ate: f.ate, ...(await cmvDoPeriodo(c.admin, c.sessao.restauranteId, f.de, f.ate)) }, { headers: { 'Cache-Control': 'no-store' } })
}
