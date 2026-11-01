import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarGuarda } from '@/lib/custo/guarda'
import { geocodificar } from './geocodificar'

/**
 * 01/11/2026 (Fase 4): recusa da guarda (limite do dia batido) não entrava no cache — cada abertura do mapa de rotas
 * refazia a tentativa (RPC + 2 escritas em api_uso_dia por pedido sem coordenada), sem custo Google mas com carga no
 * banco. Agora a recusa fica no cache por 1 h.
 */
function bancoFalso(limite: number) {
  let chamadas = 0
  const cache = new Map<string, Record<string, unknown>>()
  const rpc = vi.fn(async (_fn: string, p: { p_limite: number }) => {
    if (chamadas >= Math.min(limite, p.p_limite)) return { data: { permitido: false, chamadas, limite }, error: null }
    chamadas++
    return { data: { permitido: true, chamadas, limite }, error: null }
  })
  const admin = {
    rpc,
    from: () => ({
      insert: async () => ({ error: null }),
      upsert: async (v: Record<string, unknown>) => { cache.set(v.chave as string, v); return { error: null } },
      select: () => ({ eq: (_c: string, chave: string) => ({ maybeSingle: async () => ({ data: cache.get(chave) ?? null }) }) }),
    }),
  }
  return { admin: admin as never, rpc, cache, get chamadas() { return chamadas } }
}

beforeEach(() => { _zerarGuarda(); process.env.GOOGLE_MAPS_SERVER_KEY = 'teste' })

describe('geocodificar com a guarda recusando', () => {
  it('grava a recusa no cache por 1 h e a 2ª tentativa nem passa pela guarda', async () => {
    const b = bancoFalso(0)
    const r1 = await geocodificar(b.admin, 'Rua A, 10, Centro', 'L1')
    expect(r1).toEqual({ coord: null, motivo: 'indisponivel' })
    const linha = [...b.cache.values()][0] as { ok: boolean; motivo: string; expira_em: string }
    expect(linha.ok).toBe(false)
    expect(linha.motivo).toMatch(/guarda/)
    expect(Date.parse(linha.expira_em) - Date.now()).toBeGreaterThan(50 * 60_000)
    const antes = b.rpc.mock.calls.length
    await geocodificar(b.admin, 'Rua A, 10, Centro', 'L1')
    expect(b.rpc.mock.calls.length).toBe(antes)
  })
})
