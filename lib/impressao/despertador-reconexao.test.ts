import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Bug latente (26/10): quando o canal do despertador caía, o código agendava `velho.unsubscribe()` e criava um canal
 * novo. Só que o unsubscribe dispara o próprio callback com CLOSED (realtime-js, RealtimeChannel `_onClose`) e, nesse
 * momento, `e.canal` já era o NOVO — o callback do velho o derrubava e agendava outra volta: reconexão a cada ~3 s até
 * o próximo deploy, com um createClient (WebSocket) novo por volta.
 */

type Cb = (s: string) => void
interface CanalFalso { cb: Cb | null; topico: string; unsubscribe: () => Promise<string> }
const canais: CanalFalso[] = []
interface ClienteFalso { removeChannel: ReturnType<typeof vi.fn>; desligado: boolean; abertos: CanalFalso[] }
const clientes: ClienteFalso[] = []
// Quem cada tabela avisa (Task 4, 29/10): guarda os callbacks de postgres_changes do canal.
const handlers: { tabela: string; f: (p: Record<string, unknown>) => void }[] = []
/** Como o servidor responde à saída do canal: 'ok' (sai e é desmontado) ou 'timed out' (socket caído: fica no cliente). */
let respostaSaida = 'ok'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const cliente: ClienteFalso & Record<string, unknown> = {
      desligado: false,
      abertos: [],
      // Como no realtime-js 2.108 (RealtimeClient.channel): mesmo tópico ainda no cliente → devolve o canal VELHO.
      channel: (topico: string) => {
        const existe = cliente.abertos.find((x) => x.topico === topico)
        if (existe) return existe
        const c: CanalFalso & { on: () => unknown; subscribe: (cb: Cb) => unknown } = {
          cb: null,
          topico,
          on: ((_ev: string, filtro: { table: string }, f: (p: Record<string, unknown>) => void) => { handlers.push({ tabela: filtro.table, f }); return c }) as () => unknown,
          // Canal já inscrito uma vez não registra callback de novo (a biblioteca só entra se estiver "closed").
          subscribe: (cb: Cb) => { if (!c.cb) c.cb = cb; return c },
          // Como na biblioteca: sair do canal dispara o callback com CLOSED — depois, quando o servidor confirma.
          unsubscribe: async () => { setTimeout(() => c.cb?.('CLOSED'), 50); return respostaSaida },
        }
        canais.push(c)
        cliente.abertos.push(c)
        return c
      },
      removeChannel: vi.fn(async (c: CanalFalso) => {
        const s = await c.unsubscribe()
        if (s === 'ok') cliente.abertos = cliente.abertos.filter((x) => x !== c)
        return s
      }),
      removeAllChannels: vi.fn(async () => { cliente.abertos = []; return [] }),
      realtime: { disconnect: () => { cliente.desligado = true } },
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
    handlers.length = 0
    respostaSaida = 'ok'
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
    // A reconexão acontece na próxima espera do Assistente (nenhuma espera = nenhuma tentativa).
    await vi.advanceTimersByTimeAsync(5_000)
    despertadorConectado()
    canais[1].cb?.('SUBSCRIBED')
    for (let s = 0; s < 55; s++) { await vi.advanceTimersByTimeAsync(1_000); despertadorConectado() }

    expect(canais.length).toBe(2) // o original + 1 reconexão
    expect(clientes.filter((c) => !c.desligado).length).toBe(1) // o cliente velho é desligado: nenhuma conexão acumulada
  })

  /**
   * 05/11 (alerta 607 req/min): o despertador do servidor ficou "não conectado" das 12h até a noite — sem nenhuma
   * inscrição no Realtime — e cada espera do Assistente virou checagem a cada 2 s (3 Assistentes ≈ 600 req/min).
   * Só um deploy destravava: `garantirCanal` não recriava enquanto existisse `e.canal`.
   */
  it('inscrição que nunca responde: recomeça com cliente novo depois do prazo, e o velho é desligado', async () => {
    const { despertadorConectado } = await import('./despertador')
    despertadorConectado() // canal 0: o servidor nunca responde
    for (let s = 0; s < 40; s++) { await vi.advanceTimersByTimeAsync(1_000); despertadorConectado() } // esperas chamando
    expect(canais.length).toBe(2)
    expect(clientes[0].desligado).toBe(true)
    canais[1].cb?.('SUBSCRIBED')
    expect(despertadorConectado()).toBe(true)
  })

  it('queda com saída sem confirmação (socket caído): não reaproveita o canal velho do mesmo tópico', async () => {
    respostaSaida = 'timed out'
    const { despertadorConectado } = await import('./despertador')
    despertadorConectado()
    canais[0].cb?.('SUBSCRIBED')
    canais[0].cb?.('CHANNEL_ERROR')
    // Esperas do Assistente chamando durante a janela de reconexão (antes: pegavam o canal velho e travavam).
    for (let s = 0; s < 60; s++) { await vi.advanceTimersByTimeAsync(1_000); despertadorConectado() }
    const novo = canais[canais.length - 1]
    expect(novo).not.toBe(canais[0])
    novo.cb?.('SUBSCRIBED')
    expect(despertadorConectado()).toBe(true)
  })

  it('Realtime fora por 1 h: tentativas com espera crescente e teto (regra 1), nunca uma por espera', async () => {
    const { despertadorConectado } = await import('./despertador')
    despertadorConectado()
    for (let s = 0; s < 3600; s++) { await vi.advanceTimersByTimeAsync(1_000); despertadorConectado() }
    // 30 s, 60 s, 2 min, 4 min, 5 min (teto)… ≈ 14 em 1 h; sem espera crescente seriam 120.
    expect(canais.length).toBeGreaterThan(5)
    expect(canais.length).toBeLessThan(20)
    expect(clientes.filter((c) => !c.desligado).length).toBe(1)
  })

  it('cada tabela avisa só a sua espera: impressao_trabalhos → trabalhos; pedidos → pedidos', async () => {
    const { despertadorConectado, esperarNovidade } = await import('./despertador')
    despertadorConectado()
    canais[0].cb?.('SUBSCRIBED')
    const deTabela = (t: string) => handlers.find((h) => h.tabela === t)!.f
    const pedidos = esperarNovidade('loja-r', 10_000)
    const trabalhos = esperarNovidade('loja-r', 10_000, undefined, 'trabalhos')
    const resultado: string[] = []
    void pedidos.then((r) => resultado.push(`pedidos:${r}`))
    void trabalhos.then((r) => resultado.push(`trabalhos:${r}`))

    deTabela('impressao_trabalhos')({ eventType: 'INSERT', new: { restaurante_id: 'loja-r' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(resultado).toEqual(['trabalhos:aviso'])

    deTabela('pedidos')({ eventType: 'INSERT', new: { restaurante_id: 'loja-r', status: 'recebido' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(resultado).toEqual(['trabalhos:aviso', 'pedidos:aviso'])
  })

  it('reconectou: volta a ficar conectado', async () => {
    const { despertadorConectado } = await import('./despertador')
    despertadorConectado()
    canais[0].cb?.('TIMED_OUT')
    await vi.advanceTimersByTimeAsync(5_000)
    despertadorConectado()
    canais[1].cb?.('SUBSCRIBED')
    expect(despertadorConectado()).toBe(true)
  })
})
