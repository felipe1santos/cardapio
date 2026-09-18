import { describe, it, expect } from 'vitest'
import { sanearItensLancamento } from './lancamento-mesa'

const ID = '11111111-1111-4111-8111-111111111111'

describe('sanearItensLancamento — o navegador não decide nada além do pedido', () => {
  it('passa o que é do garçom e descarta o resto', () => {
    const r = sanearItensLancamento([
      {
        itemId: ID, quantidade: 2, observacao: ' sem cebola ', complementos: ['Bacon'], saborNome: 'Calabresa',
        // Tudo isto é decisão do servidor e some:
        preco: 0.01, precoUnitario: 0, total: 0, restauranteId: 'x', canal: 'delivery', comandaId: 'y',
        pago: true, impresso: true, status: 'entregue', criadoPor: 'z',
      },
    ])
    expect(r).toEqual({
      ok: true,
      itens: [{ itemId: ID, quantidade: 2, observacao: 'sem cebola', complementos: ['Bacon'], saborNome: 'Calabresa' }],
    })
  })

  it('recusa quantidade fracionada, zero, negativa ou absurda', () => {
    for (const q of [0, -1, 1.5, 100, '3', null, Number.NaN]) {
      expect(sanearItensLancamento([{ itemId: ID, quantidade: q }]).ok, String(q)).toBe(false)
    }
  })

  it('recusa id que não é uuid', () => {
    expect(sanearItensLancamento([{ itemId: '1 or 1=1', quantidade: 1 }]).ok).toBe(false)
  })

  it('recusa opções com tipo errado ou exageradas', () => {
    expect(sanearItensLancamento([{ itemId: ID, quantidade: 1, complementos: [{ nome: 'x', preco: 0 }] }]).ok).toBe(false)
    expect(sanearItensLancamento([{ itemId: ID, quantidade: 1, complementos: Array(41).fill('a') }]).ok).toBe(false)
    expect(sanearItensLancamento([{ itemId: ID, quantidade: 1, saborNome: 42 }]).ok).toBe(false)
  })

  it('recusa corpo vazio, não-lista ou grande demais', () => {
    expect(sanearItensLancamento([]).ok).toBe(false)
    expect(sanearItensLancamento({ itemId: ID }).ok).toBe(false)
    expect(sanearItensLancamento(Array(61).fill({ itemId: ID, quantidade: 1 })).ok).toBe(false)
  })
})
