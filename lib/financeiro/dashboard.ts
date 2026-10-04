import type { SupabaseClient } from '@supabase/supabase-js'
import { dre } from './contas'

/**
 * Dashboard financeiro (Fase 6, 0144). Tudo a partir do livro-caixa (fin_dashboard) e do custo GUARDADO na venda
 * (pedido_itens_custo). Custo e lucro só para quem pode ver (custos_ver / dre_ver) — o servidor nem calcula
 * para quem não pode.
 */
export type Grupo = 'dia' | 'semana' | 'mes'
const DATA = /^\d{4}-\d{2}-\d{2}$/

interface ItemAgg { nome: string; qtd: number; receita: number; custo: number; comCusto: number; receitaComCusto: number }

async function itensDoPeriodo(admin: SupabaseClient, loja: string, de: string, ate: string, grupo: Grupo) {
  const ini = new Date(`${de}T00:00:00-03:00`).toISOString()
  const fim = new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
  const porItem = new Map<string, ItemAgg>()
  const cmvPorBucket = new Map<string, number>()
  for (let a = 0; ; a += 1000) {
    const { data, error } = await admin.from('pedido_itens')
      .select('item_id, nome, quantidade, preco_unitario, pedidos!inner(restaurante_id, status, criado_em), pedido_itens_custo(situacao, custo_unitario)')
      .eq('pedidos.restaurante_id', loja).neq('pedidos.status', 'cancelado').gte('pedidos.criado_em', ini).lt('pedidos.criado_em', fim).is('cancelado_em', null).range(a, a + 999)
    if (error) throw error
    for (const l of data ?? []) {
      const qtd = Number(l.quantidade)
      const receita = Number(l.preco_unitario) * 100 * qtd
      const k = (l.item_id as string | null) ?? `nome:${l.nome}`
      const it = porItem.get(k) ?? { nome: String(l.nome ?? '—'), qtd: 0, receita: 0, custo: 0, comCusto: 0, receitaComCusto: 0 }
      it.qtd += qtd; it.receita += receita
      const cc = (Array.isArray(l.pedido_itens_custo) ? l.pedido_itens_custo[0] : l.pedido_itens_custo) as { situacao: string; custo_unitario: number | null } | null
      if (cc && cc.custo_unitario !== null && cc.situacao !== 'sem_ficha') {
        const custo = Number(cc.custo_unitario) * qtd
        it.custo += custo; it.comCusto += qtd; it.receitaComCusto += receita
        const ped = (Array.isArray(l.pedidos) ? l.pedidos[0] : l.pedidos) as { criado_em: string }
        const b = bucketDe(new Date(ped.criado_em).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }), grupo)
        cmvPorBucket.set(b, (cmvPorBucket.get(b) ?? 0) + custo)
      }
      porItem.set(k, it)
    }
    if (!data || data.length < 1000) break
  }
  return { porItem: [...porItem.values()], cmvPorBucket }
}

/** Mesmo agrupamento do banco (date_trunc: semana começa na segunda). */
export function bucketDe(dia: string, grupo: Grupo): string {
  if (grupo === 'mes') return `${dia.slice(0, 7)}-01`
  if (grupo === 'semana') {
    const d = new Date(`${dia}T12:00:00Z`)
    const dow = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - dow)
    return d.toISOString().slice(0, 10)
  }
  return dia
}

export async function dashboardFinanceiro(admin: SupabaseClient, loja: string, de: string, ate: string, grupo: Grupo, pode: { custos: boolean; dre: boolean }) {
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) throw Object.assign(new Error('Período inválido.'), { status: 400 })
  const [{ data: d, error }, itens, dreR, { data: cfg }, { data: cmvCfg }] = await Promise.all([
    admin.rpc('fin_dashboard', { p_restaurante: loja, p_de: de, p_ate: ate, p_grupo: grupo }),
    itensDoPeriodo(admin, loja, de, ate, grupo),
    pode.dre ? dre(admin, loja, de, ate) : Promise.resolve(null),
    admin.from('fin_config').select('meta_faturamento_dia_centavos').eq('restaurante_id', loja).maybeSingle(),
    admin.from('cmv_config').select('margem_alvo_pct').eq('restaurante_id', loja).maybeSingle(),
  ])
  if (error) throw error
  const r = d as {
    faturamento: number; vendas: number; por_origem: Record<string, number>; por_forma: Record<string, number>; a_receber: number; a_conferir: number
    sangrias: number; despesas: number; divergencias_centavos: number; turnos_divergentes: number; motoboy_agora: number
    serie: { bucket: string; faturamento: number; despesas: number; vendas: number }[]
  }
  const fat = Number(r.faturamento)
  const vendas = Number(r.vendas)
  const maisVendido = [...itens.porItem].sort((a, b) => b.qtd - a.qtd)[0] ?? null
  const comCusto = itens.porItem.filter((i) => i.comCusto > 0 && i.receitaComCusto > 0)
  const maisLucrativo = pode.custos ? [...comCusto].sort((a, b) => (b.receitaComCusto - b.custo) - (a.receitaComCusto - a.custo))[0] ?? null : null
  const piorMargem = pode.custos ? [...comCusto].sort((a, b) => (a.receitaComCusto - a.custo) / a.receitaComCusto - (b.receitaComCusto - b.custo) / b.receitaComCusto)[0] ?? null : null
  const margemDe = (i: ItemAgg) => ((i.receitaComCusto - i.custo) / i.receitaComCusto) * 100
  const metaDia = cfg?.meta_faturamento_dia_centavos === null || cfg?.meta_faturamento_dia_centavos === undefined ? null : Number(cfg.meta_faturamento_dia_centavos)
  const diasDoBucket = (b: string) => (grupo === 'dia' ? 1 : grupo === 'semana' ? 7 : new Date(Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)), 0)).getUTCDate())
  const cmvAlvoPct = 100 - Number(cmvCfg?.margem_alvo_pct ?? 65)
  const cmv = dreR?.atual.cmvCentavos ?? null
  return {
    periodo: { de, ate, grupo },
    cards: {
      faturamentoBrutoCentavos: fat,
      vendas,
      ticketMedioCentavos: vendas > 0 ? Math.round(fat / vendas) : null,
      pagosCentavos: fat - Number(r.a_receber) - Number(r.a_conferir),
      naoPagosCentavos: Number(r.a_receber),
      aConferirCentavos: Number(r.a_conferir),
      despesasCentavos: Number(r.despesas),
      sangriasCentavos: Number(r.sangrias),
      divergenciasCentavos: Number(r.divergencias_centavos),
      turnosDivergentes: Number(r.turnos_divergentes),
      motoboyAgoraCentavos: Number(r.motoboy_agora),
      // Só com permissão:
      cmvCentavos: cmv,
      lucroBrutoCentavos: dreR?.atual.lucroBrutoCentavos ?? null,
      lucroLiquidoCentavos: dreR?.atual.lucroLiquidoCentavos ?? null,
      cmvPct: cmv !== null && fat > 0 ? (cmv / fat) * 100 : null,
      cmvAlvoPct,
      semCustoRegistrado: dreR?.cmv.semCustoRegistrado ?? null,
    },
    porOrigem: r.por_origem ?? {},
    porForma: r.por_forma ?? {},
    itens: {
      maisVendido: maisVendido ? { nome: maisVendido.nome, quantidade: maisVendido.qtd, receitaCentavos: Math.round(maisVendido.receita) } : null,
      maisLucrativo: maisLucrativo ? { nome: maisLucrativo.nome, lucroCentavos: Math.round(maisLucrativo.receitaComCusto - maisLucrativo.custo), margemPct: margemDe(maisLucrativo) } : null,
      piorMargem: piorMargem ? { nome: piorMargem.nome, margemPct: margemDe(piorMargem), quantidade: piorMargem.comCusto } : null,
    },
    serie: (r.serie ?? []).map((s) => ({
      bucket: s.bucket, faturamentoCentavos: Number(s.faturamento), despesasCentavos: Number(s.despesas), vendas: Number(s.vendas),
      lucroBrutoCentavos: pode.dre ? Number(s.faturamento) - Math.round(itens.cmvPorBucket.get(s.bucket) ?? 0) : null,
      metaCentavos: metaDia === null ? null : metaDia * diasDoBucket(s.bucket),
    })),
  }
}
