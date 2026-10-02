import { describe, expect, it } from 'vitest'
import { formatarCentavos, paraCentavos, somar } from './centavos'

describe('centavos', () => {
  it('converte números sem erro de ponto flutuante', () => {
    expect(paraCentavos(0.1 + 0.2)).toBe(30)
    expect(paraCentavos(32.9)).toBe(3290)
    expect(paraCentavos(1.005)).toBe(101)
    expect(paraCentavos(NaN)).toBeNull()
  })
  it('converte texto pt-BR e com ponto', () => {
    expect(paraCentavos('1.234,56')).toBe(123456)
    expect(paraCentavos('R$ 10,5')).toBe(1050)
    expect(paraCentavos('1234.5')).toBe(123450)
    expect(paraCentavos('-2,00')).toBe(-200)
    expect(paraCentavos('12,345')).toBeNull()
    expect(paraCentavos('abc')).toBeNull()
    expect(paraCentavos('')).toBeNull()
  })
  it('formata', () => {
    expect(formatarCentavos(123456)).toBe('R$ 1.234,56')
    expect(formatarCentavos(-50)).toBe('−R$ 0,50')
    expect(formatarCentavos(0)).toBe('R$ 0,00')
  })
  it('soma inteiros', () => {
    expect(somar([1050, 250, -300])).toBe(1000)
  })
})
