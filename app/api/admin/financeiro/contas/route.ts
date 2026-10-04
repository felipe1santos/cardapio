import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin } from '@/lib/financeiro/permissoes'
import { criarConta, lerEntradaConta, listarCategorias, listarContas, listarFornecedores, type FiltrosContas } from '@/lib/financeiro/contas'

/** Contas a pagar/receber (Fase 5b). GET: contas_pagar (ver). POST: contas_lancar. */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('contas_pagar')
  if ('erro' in c) return c.erro
  const u = new URL(request.url).searchParams
  const f: FiltrosContas = {
    tipo: u.get('tipo') === 'receber' ? 'receber' : u.get('tipo') === 'pagar' ? 'pagar' : null,
    situacao: (['abertas', 'vencidas', 'pagas', 'canceladas', 'todas'].includes(u.get('situacao') ?? '') ? u.get('situacao') : 'todas') as FiltrosContas['situacao'],
    de: u.get('de'), ate: u.get('ate'), busca: u.get('busca'),
  }
  const loja = c.sessao.restauranteId
  const [lista, categorias, fornecedores] = await Promise.all([listarContas(c.admin, loja, f), listarCategorias(c.admin, loja), listarFornecedores(c.admin, loja)])
  const p = (a: Parameters<typeof podeFin>[2]) => podeFin(c.sessao.papel, c.acessos, a)
  // Para a nota de compra: só nome e unidades do insumo (nunca o custo — custo exige 'ver custos').
  const { data: insumos } = p('contas_lancar')
    ? await c.admin.from('cmv_insumos').select('id, nome, unidade_compra, unidade_base').eq('restaurante_id', loja).eq('ativo', true).eq('preparado', false).order('nome')
    : { data: [] }
  return NextResponse.json({
    ...lista, categorias, fornecedores, insumos: insumos ?? [],
    pode: { lancar: p('contas_lancar'), pagar: p('contas_marcar_pago'), dre: p('dre_ver'), exportar: p('financeiro_exportar'), insumos: p('custos_ver') },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro('contas_lancar')
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const lib = b?.liberarVenda as { justificativa?: unknown; aprovacao?: { aprovadorId?: unknown; pin?: unknown; remotaId?: unknown } } | undefined
  const r = await criarConta(c, lerEntradaConta(b), String(b?.chave ?? ''), lib ? {
    liberarVenda: { justificativa: String(lib.justificativa ?? ''), aprovacao: lib.aprovacao ? { aprovadorId: String(lib.aprovacao.aprovadorId ?? ''), pin: String(lib.aprovacao.pin ?? ''), remotaId: typeof lib.aprovacao.remotaId === 'string' ? lib.aprovacao.remotaId : null } : null },
  } : {})
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo, ...r.dados }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.repetido ? 200 : 201 })
}
