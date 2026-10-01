import { describe, expect, it } from 'vitest'
import { calcularTaxas, rotuloTaxa, valorDaTaxa } from './taxas-conta'

describe('taxas da conta', () => {
  it('percentual, fixo e por pessoa', () => {
    expect(valorDaTaxa({ nome: 'Serviço', tipo: 'percentual', base: 10 }, 123.45)).toBe(12.35)
    expect(valorDaTaxa({ nome: 'Rolha', tipo: 'fixo', base: 30 }, 0)).toBe(30)
    expect(valorDaTaxa({ nome: 'Couvert', tipo: 'por_pessoa', base: 15, quantidade: 4 }, 0)).toBe(60)
  })
  it('lista: calcula sobre o subtotal e valida', () => {
    const r = calcularTaxas([
      { nome: 'Couvert artístico', tipo: 'por_pessoa', base: 15, quantidade: 3 },
      { nome: 'Taxa de rolha', tipo: 'fixo', base: '30,00' },
      { nome: 'Extra', tipo: 'percentual', base: 5 },
    ], 200)
    expect(r.ok && r.taxas.map((t) => t.valor)).toEqual([45, 30, 10])
    expect(calcularTaxas([{ nome: 'X', tipo: 'fixo', base: 1 }], 0)).toMatchObject({ ok: false })
    expect(calcularTaxas([{ nome: 'Ok', tipo: 'nada', base: 1 }], 0)).toMatchObject({ ok: false })
    expect(calcularTaxas([{ nome: 'Ok', tipo: 'percentual', base: 150 }], 0)).toMatchObject({ ok: false })
    expect(calcularTaxas([], 10)).toEqual({ ok: true, taxas: [] })
  })
  it('rótulos', () => {
    expect(rotuloTaxa({ nome: 'Couvert', tipo: 'por_pessoa', base: 15, quantidade: 2 })).toBe('Couvert (2 × R$ 15,00)')
    expect(rotuloTaxa({ nome: 'Extra', tipo: 'percentual', base: 5 })).toBe('Extra (5%)')
  })
})
