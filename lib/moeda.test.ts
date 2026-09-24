import { describe, expect, it } from 'vitest'
import { formatarReal } from './moeda'

describe('formatarReal (painel)', () => {
  it('zero, inteiros e centavos', () => {
    expect(formatarReal(0)).toBe('R$ 0,00')
    expect(formatarReal(7)).toBe('R$ 7,00')
    expect(formatarReal(68.5)).toBe('R$ 68,50')
    expect(formatarReal(0.05)).toBe('R$ 0,05')
  })

  it('milhar com ponto e centavos com vírgula', () => {
    expect(formatarReal(4088)).toBe('R$ 4.088,00')
    expect(formatarReal(1234567.89)).toBe('R$ 1.234.567,89')
    expect(formatarReal(999.99)).toBe('R$ 999,99')
    expect(formatarReal(1000)).toBe('R$ 1.000,00')
  })

  it('arredonda para duas casas', () => {
    expect(formatarReal(10.456)).toBe('R$ 10,46')
    expect(formatarReal(0.1 + 0.2)).toBe('R$ 0,30')
    expect(formatarReal(999.995)).toBe('R$ 1.000,00')
  })

  it('negativo leva o sinal antes do R$; -0 e NaN não viram "-R$ 0,00"/"NaN"', () => {
    expect(formatarReal(-1234.5)).toBe('-R$ 1.234,50')
    expect(formatarReal(-0)).toBe('R$ 0,00')
    expect(formatarReal(-0.001)).toBe('R$ 0,00')
    expect(formatarReal(Number.NaN)).toBe('R$ 0,00')
  })

  it('espaço comum depois do R$ (não o espaço não separável do ICU)', () => {
    expect(formatarReal(1).charCodeAt(2)).toBe(32)
  })
})
