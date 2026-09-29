import { describe, expect, it, vi } from 'vitest'

// Loja com uma conta de MESA aberta e sem nenhum pedido (e uma de balcão).
const comandas = [
  { id: 'c-mesa', restaurante_id: 'r1', status: 'aberta', tipo: 'mesa', pedidos: [] },
  { id: 'c-balcao', restaurante_id: 'r1', status: 'aberta', tipo: 'balcao', pedidos: [] },
]
function tabela(nome: string) {
  const filtros: [string, unknown][] = []
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (k: string, v: unknown) => { filtros.push([k, v]); return b },
    maybeSingle: async () => ({ data: { modulo_mesas_ativo: true }, error: null }),
    update: () => b,
    then: (ok: (v: unknown) => unknown) => {
      const linhas = nome === 'comandas'
        ? comandas.filter((c) => filtros.every(([k, v]) => (k.includes('.') ? false : (c as Record<string, unknown>)[k] === v)))
        : []
      return Promise.resolve({ data: linhas, error: null }).then(ok)
    },
  }
  return b
}
vi.mock('@/lib/supabase/server', () => ({ getServerSupabase: async () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({ from: tabela }) }))
vi.mock('@/lib/auth/session', () => ({ getCurrentSession: async () => ({ restauranteId: 'r1', papel: 'dono' }) }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(async () => undefined) }))

import { GET, PUT } from './route'

describe('módulo de mesas — contas abertas', () => {
  it('conta de mesa aberta SEM pedido conta (balcão não)', async () => {
    const j = await (await GET())!.json()
    expect(j.contasAbertas).toBe(1)
  })
  it('não deixa desligar com essa conta aberta', async () => {
    const r = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ ativo: false }) }))
    expect(r!.status).toBe(409)
  })
})
