import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, act } from '@testing-library/react'

/**
 * Egress (26/10): a leitura de segurança do alarme rodava a cada 20 s em toda aba do painel (3 consultas por vez,
 * ~44 mil/dia). O tempo real é quem avisa o pedido novo; o relógio só cobre evento perdido — 60 s bastam.
 */

const listar = vi.fn(async () => [] as { id: string; numero: number }[])
vi.mock('@/lib/queries/pedidos', () => ({ listarRecebidosParaAlarme: (...a: unknown[]) => listar(...(a as [])) }))
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c },
    removeChannel: vi.fn(),
  }),
}))
vi.mock('@/components/pedidos/use-alarme', () => ({
  useAlarmePedidos: () => ({ aoAtualizarPedidos: vi.fn(), somAtivo: false, bloqueado: false, setSomAtivo: vi.fn(), testar: vi.fn() }),
}))

describe('AlarmeProvider — leitura de segurança', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listar.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ assistente: false }) })))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('em 2 minutos parado: 1 leitura inicial + 2 do relógio (não 6)', async () => {
    const { AlarmeProvider } = await import('./alarme-global')
    render(<AlarmeProvider restauranteId="loja1" ativo><div /></AlarmeProvider>)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(listar).toHaveBeenCalledTimes(3)
  })
})
