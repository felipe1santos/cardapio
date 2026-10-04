import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { buscarFluxo, csvDoExtrato, csvDoFluxo, extratoDoTurnoFluxo, opcoesDosFiltros } from '@/lib/financeiro/fluxo'
import { filtrosParaQuery, lerFiltros } from '@/lib/financeiro/fluxo-regras'

/**
 * Exportação do Fluxo de Caixa — permissão própria "Exportar relatórios financeiros" (financeiro_exportar).
 * Sempre com os filtros da tela. Toda exportação vai para a auditoria (quem, quando, filtros, formato).
 *   GET ?formato=csv&<filtros>           → arquivo CSV (Excel pt-BR) do período
 *   GET ?formato=csv&turno=<id>          → CSV do extrato de um turno
 *   GET ?formato=pdf&<filtros>[&turno=]  → dados para a página de impressão (o navegador gera o PDF)
 */
const UUID = /^[0-9a-f-]{36}$/i

export async function GET(request: Request) {
  const c = await contextoFinanceiro('financeiro_exportar')
  if ('erro' in c) return c.erro
  const sp = new URL(request.url).searchParams
  const formato = sp.get('formato') === 'pdf' ? 'pdf' : 'csv'
  const turno = sp.get('turno')
  const f = lerFiltros(sp)
  const loja = c.sessao.restauranteId
  const { data: rest } = await c.admin.from('restaurantes').select('nome').eq('id', loja).maybeSingle()
  const geradoEm = new Date().toISOString()
  const auditar = (dados: Record<string, unknown>) => registrarAuditoria(c.admin, {
    restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'fin.exportou_fluxo', entidade: 'caixa',
    entidadeId: turno && UUID.test(turno) ? turno : undefined, dados: { formato, filtros: filtrosParaQuery(f), dispositivo: c.dispositivo, ...dados },
  })

  if (turno) {
    if (!UUID.test(turno)) return NextResponse.json({ error: 'Turno não encontrado.' }, { status: 404 })
    const ex = await extratoDoTurnoFluxo(c, turno)
    if (!ex) return NextResponse.json({ error: 'Turno não encontrado.' }, { status: 404 })
    await auditar({ tipo: 'extrato', lancamentos: ex.lancamentos.length })
    if (formato === 'csv') {
      const dia = String(ex.turno.aberto_em).slice(0, 10)
      return new NextResponse(csvDoExtrato(ex.lancamentos), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="extrato-turno-${dia}.csv"`, 'Cache-Control': 'no-store' },
      })
    }
    return NextResponse.json({ loja: rest?.nome ?? '', geradoPor: c.sessao.nome, geradoEm, ...ex }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const { linhas, totais } = await buscarFluxo(c.admin, loja, f)
  await auditar({ tipo: 'periodo', turnos: linhas.length })
  if (formato === 'csv') {
    return new NextResponse(csvDoFluxo(linhas, !!f.produto), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="fluxo-de-caixa-${f.de}-a-${f.ate}.csv"`, 'Cache-Control': 'no-store' },
    })
  }
  const opcoes = await opcoesDosFiltros(c.admin, loja)
  return NextResponse.json({ loja: rest?.nome ?? '', geradoPor: c.sessao.nome, geradoEm, filtros: f, linhas, totais, opcoes }, { headers: { 'Cache-Control': 'no-store' } })
}
