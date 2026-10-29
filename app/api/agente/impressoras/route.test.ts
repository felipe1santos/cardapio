import { describe, it, expect, vi, beforeEach } from 'vitest'

const descobrir = vi.fn(async () => ({ ok: true as const, valor: 2 }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({}) }))
vi.mock('@/lib/impressao/credenciais', () => ({ identificarAgente: async () => ({ tipo: 'agente', agenteId: 'ag-1' }) }))
vi.mock('@/lib/impressao/servico', async (orig) => ({ ...(await orig<typeof import('@/lib/impressao/servico')>()), descobrir }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn() }))

const { POST } = await import('./route')
const { esquecerDescoberta } = await import('@/lib/impressao/descoberta-memo')

const req = (corpo: unknown) => new Request('http://x/api/agente/impressoras', { method: 'POST', body: JSON.stringify(corpo) })

describe('POST /api/agente/impressoras', () => {
  beforeEach(() => { descobrir.mockClear(); esquecerDescoberta() })

  it('mesmo corpo 2x: descobrir 1 vez e a 2ª resposta traz semMudanca', async () => {
    const corpo = { impressoras: ['A', 'B'], diagnosticos: { A: { papelLarguraMm: 80 } } }
    const r1 = await (await POST(req(corpo))).json()
    const r2 = await (await POST(req(corpo))).json()
    expect(descobrir).toHaveBeenCalledTimes(1)
    expect(r1).toEqual({ ok: true, total: 2 })
    expect(r2).toEqual({ ok: true, total: 2, semMudanca: true })
  })
  it('falha do descobrir não marca como gravado', async () => {
    descobrir.mockResolvedValueOnce({ ok: false, erro: 'x', codigo: 'c', status: 400 } as never)
    await POST(req({ impressoras: ['A'] }))
    await POST(req({ impressoras: ['A'] }))
    expect(descobrir).toHaveBeenCalledTimes(2)
  })
})
