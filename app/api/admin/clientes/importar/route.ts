import { NextResponse } from 'next/server'
import { autorizarClientesCsv, gravarLote, obterImportacao, type Modo } from '@/lib/queries/clientes-importacao'
import { LIMITE_LINHAS, LOTE_IMPORTACAO } from '@/lib/clientes-csv'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Importação em lotes. POST:
 *   { acao: 'lote', chave, arquivoNome, modo, totalLinhas, errosArquivo, lote, linhas }
 *   { acao: 'concluir', chave }
 * A `chave` (gerada uma vez por arquivo no navegador) faz a importação ser a mesma em
 * qualquer reenvio. Lote já gravado não é gravado de novo.
 */
const MODOS: Modo[] = ['ignorar', 'completar', 'atualizar']

export async function POST(request: Request) {
  const a = await autorizarClientesCsv()
  if ('erro' in a) return a.erro
  const { sessao, admin } = a
  const corpo = await request.json().catch(() => null)
  const chave = typeof corpo?.chave === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(corpo.chave) ? corpo.chave : null
  if (!chave) return NextResponse.json({ error: 'Importação inválida.' }, { status: 400 })

  if (corpo.acao === 'concluir') {
    const imp = await obterImportacao(admin, sessao.restauranteId, chave)
    if (!imp) return NextResponse.json({ error: 'Importação não encontrada.' }, { status: 404 })
    if (imp.status === 'processando') {
      const { data: fechou } = await admin.from('clientes_importacoes').update({ status: 'concluida', concluido_em: new Date().toISOString() }).eq('id', imp.id).eq('status', 'processando').select('*').maybeSingle()
      if (fechou) {
        await registrarAuditoria(admin, {
          restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
          acao: 'clientes.importou', entidade: 'clientes_importacao', entidadeId: imp.id,
          dados: { arquivo: fechou.arquivo_nome, modo: fechou.modo, linhas: fechou.total_linhas, criados: fechou.criados, atualizados: fechou.atualizados, ignorados: fechou.ignorados, erros: fechou.erros },
        })
        return NextResponse.json({ importacao: fechou })
      }
    }
    return NextResponse.json({ importacao: await obterImportacao(admin, sessao.restauranteId, chave) })
  }

  if (corpo.acao !== 'lote') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const modo = MODOS.includes(corpo.modo) ? (corpo.modo as Modo) : null
  const lote = Number(corpo.lote)
  const totalLinhas = Number(corpo.totalLinhas)
  const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : null
  if (!modo || !Number.isInteger(lote) || lote < 0 || !linhas || linhas.length > LOTE_IMPORTACAO || !(totalLinhas > 0 && totalLinhas <= LIMITE_LINHAS)) {
    return NextResponse.json({ error: 'Lote inválido.' }, { status: 400 })
  }

  let imp = await obterImportacao(admin, sessao.restauranteId, chave)
  if (!imp) {
    const { error } = await admin.from('clientes_importacoes').insert({
      restaurante_id: sessao.restauranteId, chave, usuario_id: sessao.userId, usuario_nome: sessao.nome,
      arquivo_nome: String(corpo.arquivoNome ?? '').slice(0, 200), modo, total_linhas: totalLinhas,
      erros: Math.max(0, Math.min(LIMITE_LINHAS, Number(corpo.errosArquivo) || 0)),
    })
    // 23505 = outro lote da mesma importação criou o registro ao mesmo tempo: segue com ele.
    if (error && error.code !== '23505') throw error
    imp = await obterImportacao(admin, sessao.restauranteId, chave)
  }
  if (!imp) return NextResponse.json({ error: 'Não foi possível iniciar a importação.' }, { status: 500 })
  if (imp.status !== 'processando') return NextResponse.json({ error: 'Esta importação já foi concluída.', importacao: imp }, { status: 409 })
  const r = await gravarLote(admin, imp, sessao.restauranteId, lote, linhas)
  return NextResponse.json({ lote, ...r })
}
