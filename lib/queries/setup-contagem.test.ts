import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { conta } from './setup'
import { contarBadgesNav } from './pedidos'

describe('conta (checklist)', () => {
  it('número quando a contagem veio', () => {
    expect(conta({ status: 'fulfilled', value: { count: 7 } })).toBe(7)
    expect(conta({ status: 'fulfilled', value: { count: 0 } })).toBe(0)
  })
  it('503/erro do PostgREST (resolvido com error e count null) → null, não 0', () => {
    expect(conta({ status: 'fulfilled', value: { count: null, error: { message: '' } } })).toBeNull()
    expect(conta({ status: 'fulfilled', value: { count: null } })).toBeNull()
  })
  it('promessa rejeitada → null', () => {
    expect(conta({ status: 'rejected', reason: new Error('rede') })).toBeNull()
  })
})

/** Cliente falso: cada `from().select().eq()...` resolve com o próximo resultado da fila. */
function clienteCom(...resultados: { count: number | null; error: unknown }[]) {
  const fila = [...resultados]
  const consulta = (): unknown => {
    const r = fila.shift()
    const q: Record<string, unknown> = { then: (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok) }
    for (const m of ['select', 'eq']) q[m] = () => q
    return q
  }
  return { from: vi.fn(consulta) } as unknown as SupabaseClient
}

describe('contarBadgesNav', () => {
  it('devolve as contagens quando as duas vêm', async () => {
    await expect(contarBadgesNav(clienteCom({ count: 2, error: null }, { count: 1, error: null }), 'loja')).resolves.toEqual({ novosPedidos: 2, logisticaPendente: 1 })
  })
  it('uma contagem com 503 → lança (o layout mantém o badge que já mostrava)', async () => {
    await expect(contarBadgesNav(clienteCom({ count: null, error: { message: '' } }, { count: 1, error: null }), 'loja')).rejects.toThrow()
    await expect(contarBadgesNav(clienteCom({ count: 3, error: null }, { count: null, error: null }), 'loja')).rejects.toThrow()
  })
})
