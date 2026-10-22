import { describe, expect, it } from 'vitest'
import { etiquetaParceiroPix, lerParceiroPix, precisaPixAntes, precoMudouDemais, textoPixParceiro, venceuPixParceiro } from './parceiro-pix'

describe('Pix antes do parceiro que não recebe na entrega', () => {
  it('só Uber e Lalamove, e só pedido não pago', () => {
    expect(precisaPixAntes('uber', { pago: false })).toBe(true)
    expect(precisaPixAntes('lalamove', { pago: false })).toBe(true)
    expect(precisaPixAntes('uber', { pago: true })).toBe(false)
    expect(precisaPixAntes('foody', { pago: false })).toBe(false)
  })
  it('preço: mais de 20% acima pede confirmação', () => {
    expect(precoMudouDemais(10, 12)).toBe(false)
    expect(precoMudouDemais(10, 12.01)).toBe(true)
    expect(precoMudouDemais(0, 50)).toBe(false)
  })
  it('vence em 10 min', () => {
    const t = Date.parse('2026-10-21T12:00:00Z')
    expect(venceuPixParceiro('2026-10-21T11:51:00Z', t)).toBe(false)
    expect(venceuPixParceiro('2026-10-21T11:50:00Z', t)).toBe(true)
  })
  it('lê o estado do pedido com segurança', () => {
    expect(lerParceiroPix(null)).toBeNull()
    expect(lerParceiroPix({ provedor: 'uber', estado: 'xx' })).toBeNull()
    expect(lerParceiroPix({ provedor: 'uber', estado: 'aguardando', preco: 14.3, desde: 'x' })?.estado).toBe('aguardando')
  })
  it('textos', () => {
    expect(textoPixParceiro({ numero: 12, valor: 42.5 })).toContain('R$ 42,50')
    expect(etiquetaParceiroPix({ provedor: 'uber', estado: 'aguardando', preco: 10, desde: '' }, 'Uber')).toBe('Aguardando Pix para chamar Uber')
  })
})
