import { describe, expect, it } from 'vitest'
import { AVISO_SEM_CUSTO, cmvPercentual } from './cmv-pct'

describe('% do CMV só sobre as vendas com custo', () => {
  it('período sem nenhuma venda com custo: sem %, pede o cadastro', () => {
    expect(cmvPercentual({ cmvCentavos: 0, vendidoComCustoCentavos: 0, vendidoCentavos: 6600 })).toEqual({ pct: null, semCustoPct: 100, aviso: AVISO_SEM_CUSTO })
  })
  it('período misto (caso de 09/10: R$ 75 vendidos, R$ 9 com custo R$ 3) → 33%, não 4%', () => {
    const r = cmvPercentual({ cmvCentavos: 300, vendidoComCustoCentavos: 900, vendidoCentavos: 7500 })
    expect(r.pct).toBeCloseTo(33.333, 2)
    expect(r.semCustoPct).toBeCloseTo(88, 0)
    expect(r.aviso).toBe('88% das vendas do período sem custo cadastrado')
  })
  it('todas as vendas com custo: % sem aviso', () => {
    expect(cmvPercentual({ cmvCentavos: 3000, vendidoComCustoCentavos: 10000, vendidoCentavos: 10000 })).toEqual({ pct: 30, semCustoPct: 0, aviso: null })
  })
  it('venda com custo estornada sai das duas pontas (CMV e vendido): volta a "sem custo"', () => {
    expect(cmvPercentual({ cmvCentavos: 0, vendidoComCustoCentavos: 0, vendidoCentavos: 6600 }).aviso).toBe(AVISO_SEM_CUSTO)
  })
  it('sem venda: nada (sem NaN, sem divisão por zero)', () => {
    expect(cmvPercentual({ cmvCentavos: 0, vendidoComCustoCentavos: 0, vendidoCentavos: 0 })).toEqual({ pct: null, semCustoPct: null, aviso: null })
  })
  it('fração pequena sem custo', () => {
    expect(cmvPercentual({ cmvCentavos: 100, vendidoComCustoCentavos: 99950, vendidoCentavos: 100000 }).aviso).toBe('menos de 1% das vendas do período sem custo cadastrado')
  })
})
