import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConfigCanal } from '../config'
import { enviarStatusIfood, motivosCancelamentoIfood } from './cliente'

const admin = {} as SupabaseClient
const cfg = { canal: 'ifood', credenciais: { clientId: 'a', clientSecret: 'b' }, accessToken: 'tok', tokenExpiraEm: '2999-01-01T00:00:00Z' } as ConfigCanal
const chamadas: { url: string; init: RequestInit }[] = []
const responder = (status: number, corpo: unknown = null) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
  chamadas.push({ url, init })
  return new Response(corpo === null ? null : JSON.stringify(corpo), { status })
}))

afterEach(() => { chamadas.length = 0; vi.unstubAllGlobals() })

describe('iFood: cancelamento', () => {
  it('manda o código escolhido em reason', async () => {
    responder(202)
    await enviarStatusIfood(admin, cfg, 'p1', 'cancelado', { codigoCancelamento: '503' })
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ reason: '503' })
  })

  it('sem código escolhido, usa 501 (problemas de sistema)', async () => {
    responder(202)
    await enviarStatusIfood(admin, cfg, 'p1', 'cancelado')
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ reason: '501' })
  })

  it('lista os motivos que o iFood aceita para o pedido', async () => {
    responder(200, { reasons: [{ code: '503', description: 'ITEM INDISPONÍVEL' }] })
    expect(await motivosCancelamentoIfood(admin, cfg, 'p1')).toEqual([{ codigo: '503', descricao: 'ITEM INDISPONÍVEL' }])
    expect(chamadas[0].url).toContain('/orders/p1/cancellationReasons')
  })

  it('204 = pedido sem motivo disponível', async () => {
    responder(204)
    expect(await motivosCancelamentoIfood(admin, cfg, 'p1')).toEqual([])
  })
})

describe('iFood: despacho', () => {
  it('entrega própria avisa com deliveredBy MERCHANT', async () => {
    responder(202)
    await enviarStatusIfood(admin, cfg, 'p1', 'despachado', { entregaPelaLoja: true })
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ deliveredBy: 'MERCHANT' })
  })

  it('entregador do iFood: não chama dispatch', async () => {
    responder(202)
    expect(await enviarStatusIfood(admin, cfg, 'p1', 'despachado', { entregaPelaLoja: false })).toBe('nao_se_aplica')
    expect(chamadas).toHaveLength(0)
  })
})
