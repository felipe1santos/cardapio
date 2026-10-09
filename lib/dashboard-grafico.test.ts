import { describe, expect, it } from 'vitest'
import { baldesVazios, escolherAgrupamento, inicioDoBalde, montarBaldes, resumir, type PedidoGrafico } from './dashboard-grafico'

// 09/10/2026 00:00 em Brasília = 03:00 UTC
const DIA9 = Date.UTC(2026, 9, 9, 3)
const H = 3_600_000, D = 24 * H

describe('gráfico do dashboard: agrupamento', () => {
  it('1 dia → hora; 7 e 30 dias → dia; 6 meses → semana; 1 ano → mês', () => {
    expect(escolherAgrupamento({ inicio: DIA9, fim: DIA9 + D })).toBe('hora')
    expect(escolherAgrupamento({ inicio: DIA9 - 6 * D, fim: DIA9 + D })).toBe('dia')
    expect(escolherAgrupamento({ inicio: DIA9 - 30 * D, fim: DIA9 + D })).toBe('dia')
    expect(escolherAgrupamento({ inicio: DIA9 - 180 * D, fim: DIA9 + D })).toBe('semana')
    expect(escolherAgrupamento({ inicio: DIA9 - 365 * D, fim: DIA9 + D })).toBe('mes')
  })
  it('fuso de Brasília: 23h59 do dia 9 fica no dia 9; 00h01 do dia 10 no dia 10', () => {
    expect(inicioDoBalde(Date.UTC(2026, 9, 10, 2, 59), 'dia')).toBe(DIA9)
    expect(inicioDoBalde(Date.UTC(2026, 9, 10, 3, 1), 'dia')).toBe(DIA9 + D)
  })
  it('semana começa na segunda (05/10/2026)', () => {
    expect(inicioDoBalde(DIA9 + 5 * H, 'semana')).toBe(Date.UTC(2026, 9, 5, 3))
  })
  it('hoje por hora: 24 baldes, rótulos 00h…23h', () => {
    const b = baldesVazios({ inicio: DIA9, fim: DIA9 + D }, 'hora')
    expect(b).toHaveLength(24)
    expect(b[0].rotulo).toBe('00h'); expect(b[23].rotulo).toBe('23h')
  })
})

describe('gráfico do dashboard: valores', () => {
  const p = (id: string, total: number, isoUtc: string, origemVenda: PedidoGrafico['origemVenda'] = 'vitrine'): PedidoGrafico => ({ id, total, criadoEm: isoUtc, origemVenda })
  const pedidos = [p('a', 18.5, '2026-10-09T15:00:00Z'), p('b', 9, '2026-10-09T15:30:00Z', 'pdv'), p('c', 12.35, '2026-10-08T23:00:00Z', 'mesa')]
  const intervalo = { inicio: DIA9 - 6 * D, fim: DIA9 + D }
  it('soma igual à lista (centavos), dias sem venda = 0, canais', () => {
    const b = montarBaldes(pedidos, intervalo, 'dia')
    expect(b).toHaveLength(7)
    const r = resumir(b)
    expect(r.faturamento).toBe(1850 + 900 + 1235)
    expect(r.pedidos).toBe(3)
    expect(r.ticket).toBe(Math.round(3985 / 3))
    expect(b[0].faturamento).toBe(0)
    expect(b[6].porCanal).toEqual({ vitrine: 1, pdv: 1, mesa: 0 })
    expect(b[5].porCanal.mesa).toBe(1) // 08/10 20h em Brasília
  })
  it('lucro só das vendas com custo; margem sobre o faturamento com custo; cobertura', () => {
    const custos = new Map([['a', 600], ['c', 400]])
    const r = resumir(montarBaldes(pedidos, intervalo, 'dia', custos))
    expect(r.lucro).toBe((1850 - 600) + (1235 - 400))
    expect(r.faturamentoComCusto).toBe(1850 + 1235)
    expect(r.margemPct).toBeCloseTo(((1250 + 835) / 3085) * 100, 6)
    expect(r.coberturaPct).toBeCloseTo((3085 / 3985) * 100, 6)
  })
  it('sem nenhuma venda com custo: margem null, cobertura 0; sem venda: tudo zerado sem NaN', () => {
    const r = resumir(montarBaldes(pedidos, intervalo, 'dia', new Map()))
    expect(r.margemPct).toBeNull(); expect(r.coberturaPct).toBe(0)
    const v = resumir(montarBaldes([], intervalo, 'dia'))
    expect(v).toMatchObject({ faturamento: 0, pedidos: 0, ticket: null, coberturaPct: null, margemPct: null })
  })
})
