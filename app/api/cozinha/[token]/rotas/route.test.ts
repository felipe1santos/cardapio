import { describe, expect, it, vi } from 'vitest'

const est = vi.hoisted(() => ({ modo: 'completa' as string }))
const atribuir = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({}) }))
vi.mock('@/lib/queries/estacoes', () => ({ buscarEstacaoPorToken: vi.fn(async () => ({ restauranteId: 'r1', modo: est.modo })) }))
vi.mock('@/lib/queries/ajustes', () => ({ buscarFluxoLoja: vi.fn(async () => ({})), usaDespachoDeRotas: () => true }))
vi.mock('@/lib/queries/pedidos', () => ({
  listarPedidosRotas: vi.fn(async () => []),
  listarEntregadores: vi.fn(async () => [{ id: 'e1', nome: 'Zé', token: 'segredo-do-entregador' }]),
  atribuirEntregadorEmLoteSeguro: atribuir,
}))

import { GET } from './route'
import { POST } from './despachar/route'

const ctx = { params: Promise.resolve({ token: 't' }) }
const despachar = () => POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ ids: ['p1'], entregadorId: 'e1' }) }), ctx)

describe('despacho de rotas pela estação da cozinha', () => {
  it('cozinha completa: lista entregadores SEM o token de acesso deles', async () => {
    est.modo = 'completa'
    const r = await GET(new Request('http://x'), ctx)
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.entregadores).toEqual([{ id: 'e1', nome: 'Zé' }])
    expect(JSON.stringify(j)).not.toContain('segredo-do-entregador')
  })

  it('estação de produção/expedição não lê nem despacha rotas', async () => {
    for (const modo of ['producao', 'expedicao']) {
      est.modo = modo
      expect((await GET(new Request('http://x'), ctx)).status).toBe(403)
      expect((await despachar()).status).toBe(403)
    }
    expect(atribuir).not.toHaveBeenCalled()
  })
})
