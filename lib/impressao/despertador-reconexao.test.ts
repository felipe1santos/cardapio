import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug latente (26/10): quando o canal do despertador caía, o código agendava `velho.unsubscribe()` e criava um canal
 * novo. Só que o unsubscribe dispara o próprio callback com CLOSED (realtime-js, RealtimeChannel `_onClose`) e, nesse
 * momento, `e.canal` já era o NOVO — o callback do velho o derrubava e agendava outra volta: reconexão a cada ~3 s até
 * o próximo deploy, com um createClient (WebSocket) novo por volta.
 */

type Cb = (s: string) => void
interface CanalFalso { cb: Cb | null; unsubscribe: () => Promise<string> }
const canais: CanalFalso[] = []
const clientes: { removeChannel: ReturnType<typeof vi.fn> }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const cliente = {
      channel: () => {
        const c: CanalFalso & { on: () => unknown; subscribe: (cb: Cb) => unknown } = {
          cb: null,
          on: () => c,
          subscribe: (cb: Cb) => { c.cb = cb; return c },
          // Como na biblioteca: sair do canal dispara o callback com CLOSED — depois, quando o servidor confirma.
          unsubscribe: async () => { setTimeout(() => c.cb?.('CLOSED'), 50); return 'ok' },
        }
        canais.push(c)
        return c
      },
      removeChannel: vi.fn(async (c: CanalFalso) => { await c.unsubscribe(); return 'ok' }),
    }
    clientes.push(cliente)
    return cliente
  },
}))

describe('despertador: reconexão depois de uma queda', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    canais.length = 0
    clientes.length = 0
    delete (globalThis as { __menuziaDespertador?: unknown }).__menuziaDespertador
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave'
    vi.resetModules()
  })
  afterEach(() => { vi.useRealTimers() })

  it('uma queda gera UMA reconexão — sem ciclo e sem acumular clientes', async () => {
    const { despertadorConectado } = await import('./despertador')
    despertadorConectado()
    canais[0].cb?.('SUBSCRIBED')
    expect(despertadorConectado()).toBe(true)

    canais[0].cb?.('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(60_000)

    expect(canais.length).toBe(2) // o original + 1 reconexão
    expect(clientes.length).toBe(1) // reaproveita o cliente: nenhuma conexão nova acumulada
  })

  it('reconectou: volta a ficar conectado', async () => {
    const { despertadorConectado } = await import('./despertador')
    despertadorConectado()
    canais[0].cb?.('TIMED_OUT')
    await vi.advanceTimersByTimeAsync(5_000)
    canais[1].cb?.('SUBSCRIBED')
    expect(despertadorConectado()).toBe(true)
  })
})
