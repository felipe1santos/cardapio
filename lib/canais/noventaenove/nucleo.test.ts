import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assinarParametros99, assinaturaWebhook99Valida, lerJsonComIdsGrandes } from './nucleo'

/** 99Food (22/10/2026): IDs de 64 bits e assinatura MD5 — exigências da documentação deles. */
describe('lerJsonComIdsGrandes', () => {
  it('não perde dígitos de IDs de 64 bits (JSON.parse arredonda)', () => {
    const bruto = '{"app_id":5764607584567296012,"data":{"order_id":1152921547153933576,"order_info":{"order_index":2,"price":{"order_price":2000}}}}'
    expect(String(JSON.parse(bruto).data.order_id)).not.toBe('1152921547153933576') // o JSON.parse comum arredonda
    const j = lerJsonComIdsGrandes(bruto) as { app_id: string; data: { order_id: string; order_info: { order_index: number; price: { order_price: number } } } }
    expect(j.app_id).toBe('5764607584567296012')
    expect(j.data.order_id).toBe('1152921547153933576')
    expect(j.data.order_info.order_index).toBe(2)
    expect(j.data.order_info.price.order_price).toBe(2000)
  })
  it('não mexe em números dentro de texto nem em decimais', () => {
    const bruto = '{"phone":"12345678901234567","lat":-19.9440597,"lista":[5764607801871631353, 7],"t":"a: 99999999999999999,"}'
    const j = lerJsonComIdsGrandes(bruto) as { phone: string; lat: number; lista: unknown[]; t: string }
    expect(j.phone).toBe('12345678901234567')
    expect(j.lat).toBe(-19.9440597)
    expect(j.lista).toEqual(['5764607801871631353', 7])
    expect(j.t).toBe('a: 99999999999999999,')
  })
  it('texto inválido lança', () => {
    expect(() => lerJsonComIdsGrandes('{oi')).toThrow()
  })
})

describe('assinatura 99Food', () => {
  it('webhook: MD5(corpo cru + app_secret) no cabeçalho didi-header-sign', () => {
    const corpo = '{"type":"orderNew"}'
    const secret = 'segredo-de-teste'
    const certa = createHash('md5').update(corpo + secret).digest('hex')
    expect(assinaturaWebhook99Valida(corpo, certa, secret)).toBe(true)
    expect(assinaturaWebhook99Valida(corpo, certa.toUpperCase(), secret)).toBe(true)
    expect(assinaturaWebhook99Valida(corpo + ' ', certa, secret)).toBe(false)
    expect(assinaturaWebhook99Valida(corpo, null, secret)).toBe(false)
    expect(assinaturaWebhook99Valida(corpo, certa, '')).toBe(false)
  })
  it('chamadas: parâmetros em ordem alfabética, "k=v" com &, secret no fim, MD5 (exemplo da documentação)', () => {
    const p = { app_id: '12345', page_size: 30, page_no: 1, timestamp: 1623814795 }
    expect(assinarParametros99(p, '1234567890abcdef1234567890abcdef')).toBe(
      createHash('md5').update('app_id=12345&page_no=1&page_size=30&timestamp=16238147951234567890abcdef1234567890abcdef').digest('hex'),
    )
  })
  it('chamadas: ignora parâmetro vazio', () => {
    expect(assinarParametros99({ a: '1', b: '', c: null }, 's')).toBe(createHash('md5').update('a=1s').digest('hex'))
  })
})
