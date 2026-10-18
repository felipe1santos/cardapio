import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarGuarda } from './guarda'
import { baseLalamove, cancelarCorridaLalamove, cotarLalamove, criarCorridaLalamove, LalamoveError, type ContaLalamove } from './lalamove'

/** Banco falso: guarda liberada (ou bloqueada por limite). */
function banco(permitido = true) {
  const admin = {
    rpc: vi.fn(async () => ({ data: { permitido, chamadas: 1, limite: 600 }, error: null })),
    from: () => ({ insert: async () => ({ error: null }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }
  return admin as never
}
const CONTA: ContaLalamove = { chaves: { apiKey: 'pk_test_abc', apiSecret: 'sk_test_nao_vaza' }, ambiente: 'sandbox' }
const LOJA = { lat: -23.55, lng: -46.63, endereco: 'Praça da Sé, São Paulo' }
const CLI = { lat: -23.56, lng: -46.65, endereco: 'Av. Paulista, 1578' }
const COTACAO = { data: { quotationId: 'q1', expiresAt: '2026-10-18T20:00:00Z', priceBreakdown: { total: '14.50', currency: 'BRL' }, distance: { value: '3200', unit: 'm' }, stops: [{ stopId: 'A' }, { stopId: 'B' }] } }

beforeEach(() => _zerarGuarda())
afterEach(() => { delete process.env.LALAMOVE_BASE_URL })

describe('cliente Lalamove (sempre pela guarda)', () => {
  it('base: sandbox/produção oficiais; LALAMOVE_BASE_URL só se for localhost', () => {
    expect(baseLalamove('sandbox')).toBe('https://rest.sandbox.lalamove.com'); expect(baseLalamove('producao')).toBe('https://rest.lalamove.com')
    process.env.LALAMOVE_BASE_URL = 'https://malicioso.com'; expect(baseLalamove('sandbox')).toBe('https://rest.sandbox.lalamove.com')
    process.env.LALAMOVE_BASE_URL = 'http://127.0.0.1:4567'; expect(baseLalamove('producao')).toBe('http://127.0.0.1:4567')
  })
  it('cotação: POST /v3/quotations no sandbox com Authorization hmac, Market BR e corpo em data', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(COTACAO), { status: 200 }))
    const c = await cotarLalamove(banco(), 'L', CONTA, 'MOTORCYCLE', LOJA, CLI, 'ped-1', { fetch: f as never, agora: () => 1700000000000, requestId: () => 'r1' })
    expect(c).toMatchObject({ quotationId: 'q1', preco: 14.5, distanciaM: 3200, paradas: ['A', 'B'] })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://rest.sandbox.lalamove.com/v3/quotations')
    const h = init.headers as Record<string, string>
    expect(h.Authorization).toMatch(/^hmac pk_test_abc:1700000000000:[0-9a-f]{64}$/); expect(h.Market).toBe('BR'); expect(h['Request-ID']).toBe('r1')
    expect(JSON.parse(String(init.body)).data.serviceType).toBe('MOTORCYCLE')
    expect(String(init.body)).not.toContain('sk_test')
  })
  it('fora da área: a frase do dono, sem erro técnico', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: 'ERR_OUT_OF_SERVICE_AREA' }), { status: 422 }))
    await expect(cotarLalamove(banco(), 'L', CONTA, 'MOTORCYCLE', LOJA, CLI, 'ped-2', { fetch: f as never })).rejects.toThrow('Lalamove ainda não atende sua cidade.')
  })
  it('limite diário atingido: NÃO chama a Lalamove', async () => {
    const f = vi.fn()
    await expect(cotarLalamove(banco(false), 'L', CONTA, 'MOTORCYCLE', LOJA, CLI, 'ped-3', { fetch: f as never })).rejects.toBeInstanceOf(LalamoveError)
    expect(f).not.toHaveBeenCalled()
  })
  it('criar corrida: POST /v3/orders com quotationId e stopIds; devolve orderId, status e shareLink', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { orderId: 'o1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share/x', priceBreakdown: { total: '14.50' } } }), { status: 201 }))
    const cot = { quotationId: 'q1', preco: 14.5, moeda: 'BRL', distanciaM: 3200, expiraEm: null, paradas: ['A', 'B'] }
    const r = await criarCorridaLalamove(banco(), 'L', CONTA, cot, { nome: 'Angus', telefone: '27992534407' }, { numero: 1, clienteNome: 'Maria', clienteTelefone: '27988887777', observacao: '', complemento: '', referencia: '' }, 'ped-1', { fetch: f as never })
    expect(r).toMatchObject({ orderId: 'o1', status: 'ASSIGNING_DRIVER', shareLink: 'https://share/x' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://rest.sandbox.lalamove.com/v3/orders'); expect(JSON.parse(String(init.body)).data.sender.stopId).toBe('A')
  })
  it('cancelar: DELETE sem corpo; 409 vira a explicação dos 5 minutos', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: 'ERR_CANCELLATION_FORBIDDEN' }), { status: 409 }))
    await expect(cancelarCorridaLalamove(banco(), 'L', CONTA, 'o1', { fetch: f as never })).rejects.toThrow(/não permite mais cancelar/)
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('DELETE'); expect(init.body).toBeUndefined()
  })
})
