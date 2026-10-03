import { describe, expect, it, vi, beforeEach } from 'vitest'
import { eventIdDoPedido, parametrosDoCarrinho, rastrearConversao } from './pixel-eventos'

describe('parametrosDoCarrinho', () => {
  it('agrupa o mesmo item, soma quantidade e usa BRL', () => {
    const p = parametrosDoCarrinho([
      { itemId: 'a', qty: 2, unit: 10 },
      { itemId: 'b', qty: 1, unit: 5.5 },
      { itemId: 'a', qty: 1, unit: 13 },
    ])
    expect(p.currency).toBe('BRL')
    expect(p.content_type).toBe('product')
    expect(p.content_ids).toEqual(['a', 'b'])
    expect(p.contents).toEqual([{ id: 'a', quantity: 3, item_price: 11 }, { id: 'b', quantity: 1, item_price: 5.5 }])
    expect(p.num_items).toBe(4)
    expect(p.value).toBe(38.5)
  })
  it('value informado (com frete/desconto) manda sobre a soma dos itens', () => {
    expect(parametrosDoCarrinho([{ itemId: 'a', qty: 1, unit: 10 }], 15.9).value).toBe(15.9)
  })
  it('ignora linha sem item ou quantidade', () => {
    expect(parametrosDoCarrinho([{ itemId: '', qty: 1, unit: 1 }, { itemId: 'x', qty: 0, unit: 1 }]).num_items).toBe(0)
  })
})

describe('rastrearConversao', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
  })
  it('manda fbq e gtag uma vez por event_id', () => {
    const fbq = vi.fn(); const gtag = vi.fn()
    vi.stubGlobal('window', { fbq, gtag })
    const p = parametrosDoCarrinho([{ itemId: 'a', qty: 1, unit: 20 }])
    const id = eventIdDoPedido('123')
    rastrearConversao('Purchase', p, id, { transactionId: '123' })
    rastrearConversao('Purchase', p, id, { transactionId: '123' })
    expect(fbq).toHaveBeenCalledTimes(1)
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', expect.objectContaining({ value: 20, currency: 'BRL', content_ids: ['a'] }), { eventID: 'pedido-123' })
    expect(gtag).toHaveBeenCalledTimes(1)
    expect(gtag).toHaveBeenCalledWith('event', 'purchase', expect.objectContaining({ transaction_id: '123', value: 20, currency: 'BRL' }))
  })
  it('sem pixel configurado não quebra', () => {
    vi.stubGlobal('window', {})
    expect(() => rastrearConversao('AddToCart', parametrosDoCarrinho([]), 'x-1')).not.toThrow()
  })
})
