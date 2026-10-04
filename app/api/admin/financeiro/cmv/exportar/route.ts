import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { listaPrecificacao } from '@/lib/financeiro/cmv'
import { gerarCsvBR, type Celula } from '@/lib/financeiro/fluxo-regras'

/** CSV da precificação (mesmo padrão da Fase 4: Excel pt-BR, protegido contra fórmula, auditado). financeiro_exportar + custos_ver. */
export async function GET() {
  const c = await contextoFinanceiro('financeiro_exportar')
  if ('erro' in c) return c.erro
  const { podeFin } = await import('@/lib/financeiro/permissoes')
  if (!podeFin(c.sessao.papel, c.acessos, 'custos_ver')) return NextResponse.json({ error: 'Você não tem permissão para esta ação.' }, { status: 403 })
  const { linhas } = await listaPrecificacao(c.admin, c.sessao.restauranteId)
  const pct = (v: number | null) => (v === null ? '' : v.toFixed(1).replace('.', ','))
  const csv = gerarCsvBR([
    ['Produto', 'Variação', 'Categoria', 'Status', 'Preço (R$)', 'Custo (R$)', 'Lucro (R$)', 'Margem (%)', 'Margem-alvo (%)', 'Preço sugerido (R$)', 'Situação'],
    ...linhas.map((l) => [l.nome, l.variante ?? '', l.categoria, l.status, { n: l.precoCentavos }, { n: l.custoCentavos }, { n: l.lucroCentavos }, pct(l.margemPct),
      pct(l.margemAlvoPct), { n: l.sugestaoCentavos }, !l.temFicha ? 'Sem ficha de custo' : l.margemBaixa ? 'Margem baixa' : 'OK'] as Celula[]),
  ])
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'cmv.exportou', entidade: 'restaurante',
    entidadeId: c.sessao.restauranteId, dados: { linhas: linhas.length, dispositivo: c.dispositivo },
  })
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="precificacao.csv"', 'Cache-Control': 'no-store' } })
}
