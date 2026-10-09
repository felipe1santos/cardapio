import { describe, expect, it } from 'vitest'
import { atalhosTroco, daPedido, erroPagamentoPdv, lerPagamentoPdv, paraPedido, rotuloForma, statusAReceber, trocoLevar } from './pdv-pagamento'

describe('pagamento do PDV', () => {
  it('escolha → modelo da vitrine (pix | cartao | dinheiro) + detalhe do cartão', () => {
    expect(paraPedido({ escolha: 'credito', trocoPara: 99 })).toEqual({ forma_pagamento: 'cartao', cartao_tipo: 'credito', troco_para: null })
    expect(paraPedido({ escolha: 'debito', trocoPara: null })).toEqual({ forma_pagamento: 'cartao', cartao_tipo: 'debito', troco_para: null })
    expect(paraPedido({ escolha: 'pix', trocoPara: 50 })).toEqual({ forma_pagamento: 'pix', cartao_tipo: null, troco_para: null })
    expect(paraPedido({ escolha: 'dinheiro', trocoPara: 100 })).toEqual({ forma_pagamento: 'dinheiro', cartao_tipo: null, troco_para: 100 })
    expect(paraPedido({ escolha: 'dinheiro', trocoPara: null }).troco_para).toBeNull()
  })
  it('ida e volta', () => {
    for (const e of ['dinheiro', 'pix', 'credito', 'debito'] as const) {
      const c = paraPedido({ escolha: e, trocoPara: e === 'dinheiro' ? 50 : null })
      expect(daPedido(c.forma_pagamento, c.cartao_tipo, c.troco_para)?.escolha).toBe(e)
    }
    expect(daPedido('cartao', null, null)?.escolha).toBe('credito') // vitrine: cartão sem detalhe
  })
  it('troco tem que ser MAIOR que o total', () => {
    expect(erroPagamentoPdv(null, 10)).toMatch(/Escolha a forma/)
    expect(erroPagamentoPdv({ escolha: 'dinheiro', trocoPara: 63 }, 63)).toMatch(/mais que o total/)
    expect(erroPagamentoPdv({ escolha: 'dinheiro', trocoPara: 50 }, 63)).toMatch(/63,00/)
    expect(erroPagamentoPdv({ escolha: 'dinheiro', trocoPara: 100 }, 63)).toBeNull()
    expect(erroPagamentoPdv({ escolha: 'dinheiro', trocoPara: null }, 63)).toBeNull()
    expect(erroPagamentoPdv({ escolha: 'pix', trocoPara: null }, 63)).toBeNull()
  })
  it('levar de troco e atalhos', () => {
    expect(trocoLevar(63, 100)).toBe(37)
    expect(trocoLevar(63, null)).toBe(0)
    expect(trocoLevar(63, 50)).toBe(0)
    expect(atalhosTroco(63)).toEqual([100, 200])
    expect(atalhosTroco(15)).toEqual([20, 50, 100, 200])
  })
  it('rótulos e status (nunca "pago" antes da hora)', () => {
    expect(rotuloForma('cartao', 'debito')).toBe('Cartão débito')
    expect(rotuloForma('cartao', null)).toBe('Cartão')
    expect(statusAReceber('entrega')).toBe('A receber na entrega')
    expect(statusAReceber('retirada')).toBe('A pagar na retirada')
  })
  it('corpo da requisição: lista fechada', () => {
    expect(lerPagamentoPdv({ escolha: 'fiado' })).toBeNull()
    expect(lerPagamentoPdv({ escolha: 'pix', trocoPara: 100 })).toEqual({ escolha: 'pix', trocoPara: null })
    expect(lerPagamentoPdv({ escolha: 'dinheiro', trocoPara: '100' })).toEqual({ escolha: 'dinheiro', trocoPara: 100 })
    expect(lerPagamentoPdv({ escolha: 'dinheiro', trocoPara: -1 })).toBeNull()
  })
})

describe('cobrar agora (09/10)', () => {
  it('lê cobrarAgora só quando verdadeiro', async () => {
    const { lerPagamentoPdv } = await import('./pdv-pagamento')
    expect(lerPagamentoPdv({ escolha: 'pix', cobrarAgora: true })).toEqual({ escolha: 'pix', trocoPara: null, cobrarAgora: true })
    expect(lerPagamentoPdv({ escolha: 'pix', cobrarAgora: 'sim' })).toEqual({ escolha: 'pix', trocoPara: null })
  })
  it('chave do pagamento: UUID válido, fixa para o mesmo lançamento e diferente da do lançamento', async () => {
    const { chavePagamentoDoLancamento } = await import('./pdv-pagamento')
    const k = '3f2b8c1e-9a7d-4e21-b5c3-0d9e8f7a6b5c'
    const p = chavePagamentoDoLancamento(k)
    expect(p).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(p).toBe(chavePagamentoDoLancamento(k))
    expect(p).not.toBe(k)
  })
})
