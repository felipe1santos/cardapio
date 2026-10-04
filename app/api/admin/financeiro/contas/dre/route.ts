import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { dre } from '@/lib/financeiro/contas'
import { hojeSP } from '@/lib/financeiro/contas-regras'

/** DRE simplificado do período, com o período anterior de mesmo tamanho (dre_ver). ?de=AAAA-MM-DD&ate=AAAA-MM-DD */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('dre_ver')
  if ('erro' in c) return c.erro
  const u = new URL(request.url).searchParams
  const hoje = hojeSP()
  const de = u.get('de') ?? `${hoje.slice(0, 8)}01`
  const ate = u.get('ate') ?? hoje
  try {
    return NextResponse.json(await dre(c.admin, c.sessao.restauranteId, de, ate), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 400) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
    throw e
  }
}
