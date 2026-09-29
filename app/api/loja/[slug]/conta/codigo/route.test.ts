import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ getAdminSupabase: () => ({}) }))
vi.mock('@/lib/queries/clientes', async (orig) => ({
  ...(await orig<typeof import('@/lib/queries/clientes')>()),
  buscarRestauranteIdPorSlug: vi.fn(async () => 'r1'),
  // WhatsApp da loja fora: o código não pôde ser enviado.
  enviarCodigoVerificacao: vi.fn(async () => ({ ok: false, error: 'fora', podeFallback: true })),
}))

import { POST } from './route'

describe('fallback do código (WhatsApp da loja fora)', () => {
  it('não devolve token nem dado de cadastro — só o telefone normalizado', async () => {
    const r = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ telefone: '(27) 99999-0000' }) }), { params: Promise.resolve({ slug: 'loja' }) })
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j).toEqual({ ok: true, fallback: true, telefone: '5527999990000' })
  })
})
