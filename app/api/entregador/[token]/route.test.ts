import { afterEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({
  buscarEntregadorPorToken: vi.fn(async () => ({ id: 'e1', nome: 'Zé', restauranteId: 'r1', restauranteNome: 'Loja' })),
  listarPedidosEmRotaDoEntregador: vi.fn(async () => []),
  contarEntregasConcluidasHoje: vi.fn(async () => 0),
  calcularCaixaEntregadorHoje: vi.fn(async () => 0),
  buscarDespachoAberto: vi.fn(async () => false),
  listarPedidosDisponiveisDespacho: vi.fn(async () => []),
}))
vi.mock('@/lib/queries/pedidos', () => q)
vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({}) }))

import { GET } from './route'

const tzAntes = process.env.TZ
afterEach(() => { vi.useRealTimers(); if (tzAntes === undefined) delete process.env.TZ; else process.env.TZ = tzAntes })

describe('portal do entregador — "hoje"', () => {
  it('às 22h30 de São Paulo ainda é o mesmo dia (servidor em UTC)', async () => {
    process.env.TZ = 'UTC' // como no servidor
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T01:30:00.000Z')) // 28/09 22:30 em São Paulo
    await GET(new Request('http://x/api/entregador/t'), { params: Promise.resolve({ token: 't' }) })
    expect(q.contarEntregasConcluidasHoje).toHaveBeenCalledWith(expect.anything(), 'e1', '2026-09-28T03:00:00.000Z')
    expect(q.calcularCaixaEntregadorHoje).toHaveBeenCalledWith(expect.anything(), 'e1', '2026-09-28T03:00:00.000Z')
  })
})
