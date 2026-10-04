import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Vendas do período na MESMA base do faturamento (0145): só comandas/pedidos com recebimento no livro-caixa, no
 * período do primeiro recebimento. Produtos, CMV e a conciliação saem daqui — pedido sem lançamento não entra.
 */
export type GrupoVendas = 'dia' | 'semana' | 'mes'

export interface ItemVendido { itemId: string | null; nome: string; qtd: number; receita: number; custo: number; comCusto: number; receitaComCusto: number }
export interface Conciliacao {
  faturamentoCentavos: number
  vendas: number
  itensCentavos: number
  taxasCentavos: number
  descontosCentavos: number
  /** Recebido − total dos pedidos: taxa de serviço da comanda, gorjeta, pagamento parcial ou a mais. */
  outrosCentavos: number
  /** Recebido agora de venda cujo primeiro recebimento foi em outro período. */
  outroPeriodoCentavos: number
  /** Venda lançada à mão, sem pedido nem comanda. */
  semPedidoCentavos: number
}

export async function vendasDoPeriodo(admin: SupabaseClient, loja: string, de: string, ate: string, grupo: GrupoVendas = 'dia') {
  const { data, error } = await admin.rpc('fin_vendas_base', { p_restaurante: loja, p_de: de, p_ate: ate, p_grupo: grupo })
  if (error) throw error
  const r = (data ?? {}) as {
    itens?: { item_id: string | null; nome: string | null; qtd: number; receita: number; custo: number | null; qtd_com_custo: number | null; receita_com_custo: number | null }[]
    cmv_por_bucket?: Record<string, number>; cmv?: number; linhas?: number; sem_custo?: number; com_erro?: number
    conciliacao?: Record<string, number>
  }
  const c = r.conciliacao ?? {}
  const n = (x: unknown) => Number(x ?? 0)
  return {
    porItem: (r.itens ?? []).map((i): ItemVendido => ({
      itemId: i.item_id, nome: String(i.nome ?? '—'), qtd: n(i.qtd), receita: n(i.receita), custo: n(i.custo), comCusto: n(i.qtd_com_custo), receitaComCusto: n(i.receita_com_custo),
    })),
    cmvPorBucket: new Map(Object.entries(r.cmv_por_bucket ?? {}).map(([k, v]) => [k, n(v)])),
    cmvCentavos: Math.round(n(r.cmv)),
    linhas: n(r.linhas),
    semCustoRegistrado: n(r.sem_custo),
    comErro: n(r.com_erro),
    conciliacao: {
      faturamentoCentavos: n(c.faturamento), vendas: n(c.vendas), itensCentavos: n(c.itens), taxasCentavos: n(c.taxas), descontosCentavos: n(c.descontos),
      outrosCentavos: n(c.outros), outroPeriodoCentavos: n(c.outro_periodo), semPedidoCentavos: n(c.sem_pedido),
    } satisfies Conciliacao,
  }
}

export interface DiferencaTurno {
  turnoId: string | null; abertoEm: string | null; fechadoEm: string | null; abertoPorNome: string | null; fechadoPorNome: string | null
  diferencaCentavos: number; diferencaCartaoCentavos: number; justificativa: string | null
}

/** Sobra (+) ou falta (−) de cada turno fechado no período, como entrou no livro-caixa. */
export async function diferencasPorTurno(admin: SupabaseClient, loja: string, de: string, ate: string): Promise<DiferencaTurno[]> {
  const { data, error } = await admin.rpc('fin_diferencas_caixa', { p_restaurante: loja, p_de: de, p_ate: ate })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map((t) => ({
    turnoId: (t.turno_id as string | null) ?? null, abertoEm: (t.aberto_em as string | null) ?? null, fechadoEm: (t.fechado_em as string | null) ?? null,
    abertoPorNome: (t.aberto_por_nome as string | null) ?? null, fechadoPorNome: (t.fechado_por_nome as string | null) ?? null,
    diferencaCentavos: Number(t.diferenca_centavos ?? 0), diferencaCartaoCentavos: Number(t.diferenca_cartao_centavos ?? 0), justificativa: (t.justificativa as string | null) ?? null,
  }))
}
