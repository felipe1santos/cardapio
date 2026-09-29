import { describe, expect, it, vi } from 'vitest'

const updates = vi.hoisted(() => [] as Record<string, unknown>[])
const efeitos = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/supabase/admin', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => { updates.push(p); return b },
        eq: () => b, select: () => b,
        maybeSingle: async () => ({ data: { id: 'p1' }, error: null }),
      }
      return b
    },
  }),
}))
vi.mock('@/lib/fidelidade', () => ({ reverterBeneficiosPedidoCancelado: vi.fn(async () => undefined) }))
vi.mock('@/lib/pedido-eventos', () => ({ aplicarEfeitosStatusPedidoComTrava: efeitos }))
vi.mock('@/lib/queries/pedidos', async (orig) => ({
  ...(await orig<typeof import('@/lib/queries/pedidos')>()),
  buscarEntregadorPorToken: vi.fn(async () => ({ id: 'e1', nome: 'Zé', restauranteId: 'r1', restauranteNome: 'Loja' })),
}))

import { POST } from './route'

describe('"Não entregue" pelo app do entregador', () => {
  it('grava motivo, autor e hora e avisa o cliente do cancelamento', async () => {
    const r = await POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ token: 't', id: 'p1' }) })
    expect(r.status).toBe(200)
    expect(updates[0]).toMatchObject({ status: 'cancelado', cancelado_motivo: 'nao_entregue', cancelado_por: 'Entregador: Zé', reimprimir: false })
    expect(typeof updates[0].cancelado_em).toBe('string')
    expect(efeitos).toHaveBeenCalledWith(expect.anything(), 'p1', 'cancelado')
  })
})
