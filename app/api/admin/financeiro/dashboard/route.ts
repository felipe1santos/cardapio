import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin } from '@/lib/financeiro/permissoes'
import { dashboardFinanceiro, type Grupo } from '@/lib/financeiro/dashboard'
import { hojeSP } from '@/lib/financeiro/contas-regras'

/**
 * Dashboard financeiro (Fase 6). Exige "Financeiro — ver valores". CMV e lucro só com dre_ver; item mais lucrativo
 * e pior margem só com custos_ver (o servidor não calcula para quem não pode).
 *   ?de=AAAA-MM-DD&ate=AAAA-MM-DD&grupo=dia|semana|mes
 */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('financeiro')
  if ('erro' in c) return c.erro
  const { veValoresFin } = await import('@/lib/financeiro/permissoes')
  if (!veValoresFin(c.sessao.papel, c.acessos)) return NextResponse.json({ error: 'Você não tem permissão para ver valores.', codigo: 'sem_permissao_acao' }, { status: 403 })
  const u = new URL(request.url).searchParams
  const hoje = hojeSP()
  const de = u.get('de') ?? `${hoje.slice(0, 8)}01`
  const ate = u.get('ate') ?? hoje
  const grupo = (['dia', 'semana', 'mes'].includes(u.get('grupo') ?? '') ? u.get('grupo') : 'dia') as Grupo
  try {
    const d = await dashboardFinanceiro(c.admin, c.sessao.restauranteId, de, ate, grupo, {
      custos: podeFin(c.sessao.papel, c.acessos, 'custos_ver'), dre: podeFin(c.sessao.papel, c.acessos, 'dre_ver'),
    })
    return NextResponse.json(d, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if ((e as { status?: number }).status === 400) return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
    throw e
  }
}
