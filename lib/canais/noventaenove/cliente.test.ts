import { afterEach, describe, expect, it, vi } from 'vitest'
import { corpo, enviarStatus99, motivoCancelamento99 } from './cliente'
import type { ConfigCanal } from '../config'

vi.mock('../config', () => ({ guardarToken: vi.fn(async () => {}) }))

describe('cliente 99Food', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('corpo manda o ID de 64 bits como número cru (sem arredondar) e o resto como texto', () => {
    expect(corpo({ auth_token: 'abc', order_id: '5764607801871631353', reason_id: 1010 }, ['order_id', 'reason_id']))
      .toBe('{"auth_token":"abc","order_id":5764607801871631353,"reason_id":1010}')
  })

  it('motivo do Kanban → reason_id da 99Food', () => {
    expect(motivoCancelamento99('sem_estoque', false)).toBe(1010)
    expect(motivoCancelamento99('cliente_desistiu', false)).toBe(1050)
    expect(motivoCancelamento99('trote', true)).toBe(1073)
    expect(motivoCancelamento99('nao_entregue', true)).toBe(1060)
    expect(motivoCancelamento99('nao_entregue', false)).toBe(1080)
    expect(motivoCancelamento99('teste', false)).toBe(1080)
    expect(motivoCancelamento99(null, false)).toBe(1080)
  })

  it('confirmar: usa o token guardado e chama /order/order/confirm com o ID cru; entregue só na entrega da loja', async () => {
    vi.stubEnv('NOVENOVE_APP_ID', '5764607590091196492')
    vi.stubEnv('NOVENOVE_APP_SECRET', 'segredo')
    const chamadas: { url: string; corpo?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { chamadas.push({ url, corpo: init.body as string | undefined }); return new Response('{"errno":0,"errmsg":"ok","data":true}') }))
    const c = { restauranteId: 'loja-1', canal: '99food', accessToken: 'tok', tokenExpiraEm: new Date(Date.now() + 3600_000).toISOString() } as unknown as ConfigCanal
    expect(await enviarStatus99({} as never, c, '5764607801871631353', 'confirmado', { entregaPelaLoja: false })).toBe('ok')
    expect(chamadas[0].url).toContain('/v1/order/order/confirm')
    expect(chamadas[0].corpo).toBe('{"auth_token":"tok","order_id":5764607801871631353}')
    expect(await enviarStatus99({} as never, c, '1', 'entregue', { entregaPelaLoja: false })).toBe('sem_acao')
    expect(await enviarStatus99({} as never, c, '1', 'preparando', { entregaPelaLoja: true })).toBe('sem_acao')
    expect(await enviarStatus99({} as never, c, '1', 'entregue', { entregaPelaLoja: true })).toBe('ok')
    expect(chamadas.at(-1)?.url).toContain('/v1/order/order/delivered?auth_token=tok&order_id=1')
  })

  it('token vencido (10102): renova e repete uma vez', async () => {
    vi.stubEnv('NOVENOVE_APP_ID', '5764607590091196492')
    vi.stubEnv('NOVENOVE_APP_SECRET', 'segredo')
    const urls: string[] = []
    let confirmou = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('/order/order/confirm')) { confirmou++; return new Response(confirmou === 1 ? '{"errno":10102,"errmsg":"expired"}' : '{"errno":0,"data":true}') }
      if (url.includes('/authtoken/get')) return new Response('{"errno":0,"data":{"auth_token":"novo","token_expiration_time":9999999999}}')
      return new Response('{"errno":0,"data":true}')
    }))
    const c = { restauranteId: 'loja-1', canal: '99food', accessToken: 'velho', tokenExpiraEm: new Date(Date.now() + 3600_000).toISOString() } as unknown as ConfigCanal
    expect(await enviarStatus99({} as never, c, '7', 'confirmado', { entregaPelaLoja: false })).toBe('ok')
    expect(urls.some((u) => u.includes('/authtoken/refresh'))).toBe(true)
    expect(confirmou).toBe(2)
  })
})
