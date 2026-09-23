import type { SupabaseClient } from '@supabase/supabase-js'
import type { Intervalo } from '@/lib/dashboard-metricas'

/** Etapas do funil da vitrine, na ordem. */
export type EtapaVitrine = 'visita' | 'visualizacao' | 'sacola' | 'checkout' | 'pedido'
export const ETAPAS_VITRINE: EtapaVitrine[] = ['visita', 'visualizacao', 'sacola', 'checkout', 'pedido']

export interface AnalyticsVitrine {
  funil: Record<EtapaVitrine, number>
  funilAnterior: Record<EtapaVitrine, number>
  /** Visitantes distintos por dia (yyyy-mm-dd, fuso de São Paulo) e etapa. */
  porDia: { dia: string; tipo: EtapaVitrine; qtd: number }[]
  /** Segundos médios entre uma etapa e a seguinte; null sem amostra. */
  tempos: {
    visita_visualizacao: number | null
    visualizacao_sacola: number | null
    sacola_checkout: number | null
    checkout_pedido: number | null
  }
  visitantes: { total: number; novos: number }
  cliques: { alvo: string; cliques: number; visitantes: number }[]
  origens: { origem: string; visitas: number; pedidos: number }[]
}

const zerado = (): Record<EtapaVitrine, number> => ({ visita: 0, visualizacao: 0, sacola: 0, checkout: 0, pedido: 0 })

/**
 * Agregado do rastreio da vitrine (função `painel_analytics_vitrine`, migration
 * 0078). Devolve `null` quando a função ainda não existe no banco — o
 * Dashboard mostra o aviso em vez de quebrar.
 */
export async function carregarAnalyticsVitrine(
  supabase: SupabaseClient,
  intervalo: Intervalo,
): Promise<AnalyticsVitrine | null> {
  const { data, error } = await supabase.rpc('painel_analytics_vitrine', {
    p_inicio: new Date(Math.max(0, intervalo.inicio)).toISOString(),
    p_fim: new Date(intervalo.fim).toISOString(),
  })
  if (error || !data) return null
  const bruto = data as Partial<AnalyticsVitrine> & { funil?: Record<string, number>; funilAnterior?: Record<string, number> }
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
  const funil = zerado()
  const funilAnterior = zerado()
  for (const e of ETAPAS_VITRINE) {
    funil[e] = num(bruto.funil?.[e])
    funilAnterior[e] = num(bruto.funilAnterior?.[e])
  }
  const t = (bruto.tempos ?? {}) as Record<string, unknown>
  const seg = (v: unknown) => (v === null || v === undefined ? null : num(v))
  return {
    funil,
    funilAnterior,
    porDia: (bruto.porDia ?? []).map((p) => ({ dia: String(p.dia), tipo: p.tipo, qtd: num(p.qtd) })),
    tempos: {
      visita_visualizacao: seg(t.visita_visualizacao),
      visualizacao_sacola: seg(t.visualizacao_sacola),
      sacola_checkout: seg(t.sacola_checkout),
      checkout_pedido: seg(t.checkout_pedido),
    },
    visitantes: { total: num(bruto.visitantes?.total), novos: num(bruto.visitantes?.novos) },
    cliques: (bruto.cliques ?? []).map((c) => ({ alvo: String(c.alvo), cliques: num(c.cliques), visitantes: num(c.visitantes) })),
    origens: (bruto.origens ?? []).map((o) => ({ origem: String(o.origem), visitas: num(o.visitas), pedidos: num(o.pedidos) })),
  }
}

export interface TempoEntrega {
  criadoEm: string
  emRotaEm: string
  entregueEm: string
}

/**
 * Pedidos de entrega com a saída e a chegada carimbadas (gatilho da 0078).
 * Pedidos anteriores à migration não têm esses horários e ficam de fora — é
 * melhor medir pouco do que inventar. `null` = colunas ainda não existem.
 */
export async function carregarTemposEntrega(
  supabase: SupabaseClient,
  restauranteId: string,
): Promise<TempoEntrega[] | null> {
  const { data, error } = await supabase
    .from('pedidos')
    .select('criado_em, em_rota_em, entregue_em')
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'entrega')
    .not('em_rota_em', 'is', null)
    .not('entregue_em', 'is', null)
    .order('entregue_em', { ascending: false })
    .limit(1000)
  if (error) return null
  return ((data ?? []) as { criado_em: string; em_rota_em: string; entregue_em: string }[]).map((p) => ({
    criadoEm: p.criado_em,
    emRotaEm: p.em_rota_em,
    entregueEm: p.entregue_em,
  }))
}
