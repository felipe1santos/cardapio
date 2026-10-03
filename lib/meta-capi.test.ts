import { describe, expect, it } from 'vitest'
import { montarPurchase, sha256, telefoneNormalizado } from './meta-capi'

describe('telefoneNormalizado', () => {
  it('só dígitos com DDI 55', () => {
    expect(telefoneNormalizado('(27) 99253-4407')).toBe('5527992534407')
    expect(telefoneNormalizado('5527992534407')).toBe('5527992534407')
    expect(telefoneNormalizado('123')).toBeNull()
  })
})

describe('montarPurchase', () => {
  const base = {
    pedidoId: 'abc', numero: 315, total: 50.99, telefone: '27992534407',
    itens: [{ item_id: 'i1', quantidade: 2, preco_unitario: 20 }, { item_id: null, quantidade: 1, preco_unitario: 5 }],
    criadoEm: new Date('2026-10-02T22:03:00-03:00'),
    ctx: { ip: '189.1.2.3', userAgent: 'Mozilla/5.0 Instagram', fbp: 'fb.1.1700000000000.123456', fbc: 'fb.1.1700000000000.AbCdEf', url: 'https://app.menuzia.com.br/loja/x?fbclid=AbCdEf' },
  }
  it('mesmo event_id do navegador, BRL, itens e telefone em SHA-256', () => {
    const c = montarPurchase(base)
    const e = c.data[0]
    expect(e.event_name).toBe('Purchase')
    expect(e.event_id).toBe('pedido-abc')
    expect(e.action_source).toBe('website')
    expect(e.custom_data).toMatchObject({ currency: 'BRL', value: 50.99, content_ids: ['i1'], num_items: 2, order_id: '315' })
    expect(e.user_data.ph).toEqual([sha256('5527992534407')])
    expect(JSON.stringify(c)).not.toContain('27992534407"')
    expect(e.user_data).toMatchObject({ client_ip_address: '189.1.2.3', fbp: 'fb.1.1700000000000.123456', fbc: 'fb.1.1700000000000.AbCdEf' })
    expect(c).not.toHaveProperty('test_event_code')
  })
  it('fbp/fbc fora do formato não vão; código de teste vai quando configurado', () => {
    const c = montarPurchase({ ...base, ctx: { ...base.ctx, fbp: 'x<script>', fbc: null, url: 'javascript:alert(1)' }, testCode: 'TEST123' })
    expect(c.data[0].user_data).not.toHaveProperty('fbp')
    expect(c.data[0]).not.toHaveProperty('event_source_url')
    expect(c.test_event_code).toBe('TEST123')
  })
})
