import { describe, expect, it } from 'vitest'
import { lerValor } from './util'

describe('lerValor (valores digitados no PDV)', () => {
  it('ponto decimal do teclado Android não vira milhar', () => {
    expect(lerValor('10.50')).toBe(10.5)
    expect(lerValor('50.00')).toBe(50)
    expect(lerValor('0.5')).toBe(0.5)
  })
  it('formato brasileiro continua', () => {
    expect(lerValor('64,90')).toBe(64.9)
    expect(lerValor('1.234,5')).toBe(1234.5)
    expect(lerValor('1.234.567,00')).toBe(1234567)
    expect(lerValor('1.234')).toBe(1234)
  })
})
