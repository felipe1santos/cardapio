import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin } from '@/lib/financeiro/permissoes'
import { buscarFluxo, opcoesDosFiltros } from '@/lib/financeiro/fluxo'
import { lerFiltros } from '@/lib/financeiro/fluxo-regras'

/**
 * Financeiro › Fluxo de Caixa (Fase 4). Só leitura, só da loja da SESSÃO.
 *   GET ?de&ate&origem&forma&status&operador&motoboy&produto&pagina&porPagina
 *     → { linhas (página), total, totais (do PERÍODO INTEIRO, não da página), opcoes, podeExportar }
 * Não existe escrita aqui: lançamento não se edita nem se apaga (o livro-caixa é imutável no banco).
 */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('financeiro')
  if ('erro' in c) return c.erro
  const sp = new URL(request.url).searchParams
  const f = lerFiltros(sp)
  const porPagina = Math.min(100, Math.max(10, Number(sp.get('porPagina')) || 30))
  const pagina = Math.max(0, Math.floor(Number(sp.get('pagina')) || 0))
  try {
    const [{ linhas, totais }, opcoes] = await Promise.all([buscarFluxo(c.admin, c.sessao.restauranteId, f), opcoesDosFiltros(c.admin, c.sessao.restauranteId)])
    return NextResponse.json({
      filtros: f, total: linhas.length, pagina, porPagina,
      linhas: linhas.slice(pagina * porPagina, (pagina + 1) * porPagina),
      totais, opcoes, podeExportar: podeFin(c.sessao.papel, c.acessos, 'financeiro_exportar'),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[fluxo] falha', e)
    return NextResponse.json({ error: 'Não foi possível montar o fluxo agora.' }, { status: 500 })
  }
}
