import type { Intervalo } from './dashboard-metricas'

/**
 * Gráfico de Faturamento / Pedidos / Ticket médio do Dashboard (09/10). Puro e testado.
 *
 * Os números saem da MESMA lista de pedidos que o "Resumo do período" usa (mesmo filtro de status, de teste e de
 * período), então os totais batem centavo por centavo. Agrupamento automático no fuso de Brasília (UTC−3, sem
 * horário de verão desde 2019): 1 dia → hora; até 31 dias → dia; até 6 meses → semana (segunda a domingo);
 * acima → mês. Período sem venda aparece como zero. Lucro bruto = faturamento − custo gravado na venda, SÓ das
 * vendas que têm custo (todas as linhas do pedido com custo).
 */
export type Agrupamento = 'hora' | 'dia' | 'semana' | 'mes'
export type Canal = 'vitrine' | 'pdv' | 'mesa'

export interface PedidoGrafico { id?: string; total: number; criadoEm: string; origemVenda: Canal }
export interface Balde {
  inicio: number; rotulo: string; periodo: string
  faturamento: number; pedidos: number; porCanal: Record<Canal, number>
  /** Só das vendas com custo. */
  lucro: number; faturamentoComCusto: number
}

const H = 3_600_000, D = 24 * H
const SP = 3 * H // Brasília = UTC−3
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function escolherAgrupamento(intervalo: Intervalo): Agrupamento {
  const dias = (intervalo.fim - intervalo.inicio) / D
  if (dias <= 1.0001) return 'hora'
  if (dias <= 31.0001) return 'dia'
  if (dias <= 186.0001) return 'semana'
  return 'mes'
}

/** Início (UTC ms) do balde que contém `ms`, contado no relógio de Brasília. */
export function inicioDoBalde(ms: number, g: Agrupamento): number {
  const l = new Date(ms - SP)
  const y = l.getUTCFullYear(), m = l.getUTCMonth(), d = l.getUTCDate()
  if (g === 'hora') return Date.UTC(y, m, d, l.getUTCHours()) + SP
  if (g === 'dia') return Date.UTC(y, m, d) + SP
  if (g === 'mes') return Date.UTC(y, m, 1) + SP
  const dow = (l.getUTCDay() + 6) % 7 // segunda = 0
  return Date.UTC(y, m, d - dow) + SP
}

function proximo(ms: number, g: Agrupamento): number {
  if (g === 'hora') return ms + H
  if (g === 'dia') return ms + D
  if (g === 'semana') return ms + 7 * D
  const l = new Date(ms - SP)
  return Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 1) + SP
}

function rotulos(ms: number, g: Agrupamento): { rotulo: string; periodo: string } {
  const l = new Date(ms - SP)
  const dd = l.getUTCDate(), mm = l.getUTCMonth(), yy = l.getUTCFullYear(), hh = l.getUTCHours()
  if (g === 'hora') return { rotulo: `${String(hh).padStart(2, '0')}h`, periodo: `${dd} de ${MESES_LONGOS[mm]}, ${String(hh).padStart(2, '0')}h–${String((hh + 1) % 24).padStart(2, '0')}h` }
  if (g === 'dia') return { rotulo: `${dd} ${MESES[mm]}`, periodo: `${dd} de ${MESES_LONGOS[mm]} de ${yy}` }
  if (g === 'mes') return { rotulo: `${MESES[mm]}${mm === 0 ? ` ${String(yy).slice(2)}` : ''}`, periodo: `${MESES_LONGOS[mm]} de ${yy}` }
  const f = new Date(ms + 6 * D - SP)
  return { rotulo: `${dd} ${MESES[mm]}`, periodo: `semana de ${dd} de ${MESES[mm]} a ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]}` }
}

/** Baldes vazios de `intervalo` (fim exclusivo). Intervalo "desde o início" (inicio 0) começa no 1º pedido. */
export function baldesVazios(intervalo: Intervalo, g: Agrupamento, primeiroPedidoMs?: number): Balde[] {
  const ini = intervalo.inicio > 0 ? intervalo.inicio : primeiroPedidoMs ?? intervalo.fim - 30 * D
  const out: Balde[] = []
  for (let b = inicioDoBalde(ini, g); b < intervalo.fim && out.length < 400; b = proximo(b, g)) {
    out.push({ inicio: b, ...rotulos(b, g), faturamento: 0, pedidos: 0, porCanal: { vitrine: 0, pdv: 0, mesa: 0 }, lucro: 0, faturamentoComCusto: 0 })
  }
  return out
}

/** `custos`: centavos de custo de cada pedido que tem custo em TODAS as linhas (pedido ausente = sem custo). */
export function montarBaldes(pedidos: PedidoGrafico[], intervalo: Intervalo, g: Agrupamento, custos?: Map<string, number> | null): Balde[] {
  const primeiro = pedidos.length ? Math.min(...pedidos.map((p) => Date.parse(p.criadoEm))) : undefined
  const baldes = baldesVazios(intervalo, g, primeiro)
  const pos = new Map(baldes.map((b, i) => [b.inicio, i]))
  for (const p of pedidos) {
    const i = pos.get(inicioDoBalde(Date.parse(p.criadoEm), g))
    if (i === undefined) continue
    const b = baldes[i]
    const c = Math.round(p.total * 100)
    b.faturamento += c
    b.pedidos += 1
    b.porCanal[p.origemVenda] += 1
    const custo = p.id && custos ? custos.get(p.id) : undefined
    if (custo !== undefined) { b.lucro += c - custo; b.faturamentoComCusto += c }
  }
  return baldes
}

export interface ResumoGrafico {
  faturamento: number; pedidos: number; ticket: number | null
  lucro: number; faturamentoComCusto: number
  /** % do faturamento que tem custo (0–100); null sem venda. */
  coberturaPct: number | null
  margemPct: number | null
}

export function resumir(baldes: Balde[]): ResumoGrafico {
  const faturamento = baldes.reduce((s, b) => s + b.faturamento, 0)
  const pedidos = baldes.reduce((s, b) => s + b.pedidos, 0)
  const lucro = baldes.reduce((s, b) => s + b.lucro, 0)
  const faturamentoComCusto = baldes.reduce((s, b) => s + b.faturamentoComCusto, 0)
  return {
    faturamento, pedidos, ticket: pedidos ? Math.round(faturamento / pedidos) : null, lucro, faturamentoComCusto,
    coberturaPct: faturamento > 0 ? (faturamentoComCusto / faturamento) * 100 : null,
    margemPct: faturamentoComCusto > 0 ? (lucro / faturamentoComCusto) * 100 : null,
  }
}
