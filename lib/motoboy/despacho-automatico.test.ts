import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/queries/pedidos', () => ({ atribuirEntregadorEmLoteSeguro: vi.fn() }))
vi.mock('@/lib/pedido-eventos', () => ({ aplicarEfeitosStatusPedidoComTrava: vi.fn() }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn() }))
vi.mock('@/lib/fidelidade', () => ({ processarFidelidadePedidoEntregue: vi.fn() }))
import { escolherMotoboy, type CandidatoMotoboy } from './despacho-automatico'

const agora = new Date('2026-10-08T12:00:00Z').getTime()
const m = (x: Partial<CandidatoMotoboy>): CandidatoMotoboy => ({ id: 'x', nome: 'X', emRota: 0, ultimoAcessoEm: new Date(agora - 30_000).toISOString(), status: 'online', desativado: false, ultimaSaidaEm: null, ...x })

describe('despacho automático: quem leva o pedido', () => {
  it('quem tem menos entregas em rota', () => {
    expect(escolherMotoboy([m({ id: 'a', emRota: 2 }), m({ id: 'b', emRota: 0 }), m({ id: 'c', emRota: 1 })], agora)?.id).toBe('b')
  })
  it('empate: quem está esperando há mais tempo (saiu há mais tempo; nunca saiu = primeiro)', () => {
    const r = escolherMotoboy([
      m({ id: 'a', ultimaSaidaEm: '2026-10-08T11:50:00Z' }),
      m({ id: 'b', ultimaSaidaEm: '2026-10-08T11:10:00Z' }),
    ], agora)
    expect(r?.id).toBe('b')
    expect(escolherMotoboy([m({ id: 'a', ultimaSaidaEm: '2026-10-08T11:10:00Z' }), m({ id: 'b' })], agora)?.id).toBe('b')
  })
  it('só disponível: logado (sinal < 2 min), não pausado, não desativado', () => {
    expect(escolherMotoboy([m({ id: 'a', status: 'offline' }), m({ id: 'b', desativado: true }), m({ id: 'c', ultimoAcessoEm: new Date(agora - 5 * 60_000).toISOString() }), m({ id: 'd', ultimoAcessoEm: null })], agora)).toBeNull()
    expect(escolherMotoboy([m({ id: 'a', status: 'offline' }), m({ id: 'e', status: 'ocupado', emRota: 3 })], agora)?.id).toBe('e')
  })
})
