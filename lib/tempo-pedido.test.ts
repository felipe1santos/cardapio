import { describe, expect, it } from 'vitest'
import { corTempoPedido, textoTempoPedido } from './tempo-pedido'

const MIN = 60_000
describe('textoTempoPedido', () => {
  it('minutos abaixo de 1 hora', () => {
    expect(textoTempoPedido(0)).toBe('0 min')
    expect(textoTempoPedido(13 * MIN + 59_000)).toBe('13 min')
    expect(textoTempoPedido(59 * MIN)).toBe('59 min')
  })
  it('horas de 1 hora até 1 dia', () => {
    expect(textoTempoPedido(60 * MIN)).toBe('1 hora')
    expect(textoTempoPedido(119 * MIN)).toBe('1 hora')
    expect(textoTempoPedido(185 * MIN)).toBe('3 horas')
    expect(textoTempoPedido(23 * 60 * MIN + 59 * MIN)).toBe('23 horas')
  })
  it('dias a partir de 1 dia (o antigo "1986:17" vira "1 dia")', () => {
    expect(textoTempoPedido(24 * 60 * MIN)).toBe('1 dia')
    expect(textoTempoPedido(1986 * MIN)).toBe('1 dia')
    expect(textoTempoPedido(2 * 24 * 60 * MIN + 30 * MIN)).toBe('2 dias')
  })
  it('nunca negativo', () => {
    expect(textoTempoPedido(-5000)).toBe('0 min')
  })
})

describe('corTempoPedido', () => {
  it('mesmas faixas de alerta: 10 e 20 minutos', () => {
    expect(corTempoPedido(9 * MIN)).toBe('ok')
    expect(corTempoPedido(10 * MIN)).toBe('atencao')
    expect(corTempoPedido(20 * MIN)).toBe('atraso')
    expect(corTempoPedido(3 * 24 * 60 * MIN)).toBe('atraso')
  })
})
