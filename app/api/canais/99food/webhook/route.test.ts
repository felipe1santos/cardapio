import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tratar = vi.fn(async () => 'pedido_novo')
const buscarCfg = vi.fn(async () => ({ restauranteId: '11111111-1111-1111-1111-111111111111', canal: '99food', ativo: true }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({}) }))
vi.mock('@/lib/canais/config', () => ({ buscarConfigCanal: (...a: unknown[]) => buscarCfg(...(a as [])) }))
vi.mock('@/lib/canais/sincronizar', () => ({ canalPodeRodar: () => true, tratarEvento99: (...a: unknown[]) => tratar(...(a as [])) }))

const LOJA = '11111111-1111-1111-1111-111111111111'
const req = (corpo: string, assinatura: string | null) => new Request('https://app.menuzia.com.br/api/canais/99food/webhook', { method: 'POST', body: corpo, headers: assinatura ? { 'didi-header-sign': assinatura } : {} })
const assinar = (corpo: string) => createHash('md5').update(corpo + 'segredo').digest('hex')

describe('webhook 99Food', () => {
  beforeEach(() => { vi.stubEnv('NOVENOVE_APP_ID', '5764607590091196492'); vi.stubEnv('NOVENOVE_APP_SECRET', 'segredo'); tratar.mockClear() })
  afterEach(() => vi.unstubAllEnvs())

  it('pedido novo assinado: trata com o ID inteiro e responde {errno:0}', async () => {
    const { POST } = await import('./route')
    const corpo = `{"app_id":5764607590091196492,"app_shop_id":"${LOJA}","type":"orderNew","timestamp":1,"data":{"order_id":5764607801871631353,"order_info":{"order_id":5764607801871631353}}}`
    const r = await POST(req(corpo, assinar(corpo)))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ errno: 0, errmsg: 'ok' })
    expect(tratar).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'orderNew', '5764607801871631353', expect.anything())
  })

  it('assinatura errada ou ausente: recusa sem tratar', async () => {
    const { POST } = await import('./route')
    const corpo = `{"app_id":5764607590091196492,"app_shop_id":"${LOJA}","type":"orderNew","data":{"order_id":1}}`
    expect((await POST(req(corpo, 'x'.repeat(32)))).status).toBe(401)
    expect((await POST(req(corpo, null))).status).toBe(401)
    expect(tratar).not.toHaveBeenCalled()
  })

  it('app de outra empresa (app_id diferente): recusa', async () => {
    const { POST } = await import('./route')
    const corpo = `{"app_id":123,"app_shop_id":"${LOJA}","type":"orderNew","data":{"order_id":1}}`
    expect((await POST(req(corpo, assinar(corpo)))).status).toBe(401)
  })

  it('loja que não é do Menuzia: confirma o recebimento sem tratar', async () => {
    const { POST } = await import('./route')
    const corpo = '{"app_id":5764607590091196492,"app_shop_id":"7093","type":"orderNew","data":{"order_id":1}}'
    const r = await POST(req(corpo, assinar(corpo)))
    expect(await r.json()).toMatchObject({ errno: 0 })
    expect(tratar).not.toHaveBeenCalled()
  })
})
