import { NextResponse } from 'next/server'
import { autorizarClientesCsv } from '@/lib/queries/clientes-importacao'
import { listarClientesComMetricas, gerarCsvMetaAds } from '@/lib/queries/clientes'
import { BOM, diaSP, filtrarExportacao, nomeArquivoExportacao, planilhaCompleta, type FiltroExportacao } from '@/lib/clientes-csv'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Exportar clientes (CSV). POST { filtro, formato: 'completa'|'meta', previa? }.
 * Prévia devolve só a contagem; sem prévia devolve o arquivo e registra na auditoria.
 */
const DATA = /^\d{4}-\d{2}-\d{2}$/

export async function POST(request: Request) {
  const a = await autorizarClientesCsv()
  if ('erro' in a) return a.erro
  const { sessao, admin } = a
  const corpo = await request.json().catch(() => null)
  const f = corpo?.filtro ?? {}
  const filtro: FiltroExportacao = {
    de: typeof f.de === 'string' && DATA.test(f.de) ? f.de : null,
    ate: typeof f.ate === 'string' && DATA.test(f.ate) ? f.ate : null,
    base: f.base === 'cadastro' ? 'cadastro' : 'compra',
    recorrentes: f.recorrentes === true,
    umaVez: f.umaVez === true,
    comTelefone: f.comTelefone === true,
  }
  if (filtro.de && filtro.ate && filtro.de > filtro.ate) return NextResponse.json({ error: 'A data inicial vem depois da final.' }, { status: 400 })
  const formato = corpo?.formato === 'meta' ? 'meta' : 'completa'

  const todos = await listarClientesComMetricas(admin, sessao.restauranteId)
  const lista = filtrarExportacao(todos, filtro)
  if (corpo?.previa === true) return NextResponse.json({ quantidade: lista.length })

  const { data: loja } = await admin.from('restaurantes').select('slug').eq('id', sessao.restauranteId).maybeSingle()
  const nome = nomeArquivoExportacao(loja?.slug ?? 'loja', filtro.de, filtro.ate, diaSP(new Date().toISOString()))
  // Meta Ads: exatamente o arquivo de antes (vírgula, colunas do Meta, com BOM como a tela fazia).
  const csv = formato === 'meta' ? BOM + gerarCsvMetaAds(lista) : planilhaCompleta(lista)
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'clientes.exportou', entidade: 'clientes', entidadeId: sessao.restauranteId,
    dados: { formato: formato === 'meta' ? 'Meta Ads' : 'Planilha completa', quantidade: lista.length, de: filtro.de ?? 'início', ate: filtro.ate ?? 'hoje',
      periodo_por: filtro.base === 'compra' ? 'última compra' : 'cadastro', recorrentes: filtro.recorrentes, uma_vez: filtro.umaVez, com_telefone: filtro.comTelefone },
  })
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome}"`,
      'X-Quantidade': String(lista.length),
      'Cache-Control': 'no-store',
    },
  })
}
