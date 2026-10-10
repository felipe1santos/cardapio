import { afterEach, describe, expect, it, vi } from 'vitest'
import { buscarEstadoSessao, estadoMudou } from './sessao-cliente'

/** Desempenho (10/10): o estado da sessão é lido uma vez na abertura, não uma por parte da tela. */
describe('buscarEstadoSessao', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); estadoMudou() })
  it('partes que montam em seguida (até 15 s) reaproveitam a mesma leitura; estadoMudou força nova', async () => {
    vi.useFakeTimers()
    const f = vi.fn(async () => new Response(JSON.stringify({ financeiroAtivo: false }), { status: 200 }))
    vi.stubGlobal('fetch', f)
    estadoMudou()
    await buscarEstadoSessao()
    vi.advanceTimersByTime(5000)
    await buscarEstadoSessao()
    expect(f).toHaveBeenCalledTimes(1)
    estadoMudou()
    await buscarEstadoSessao()
    expect(f).toHaveBeenCalledTimes(2)
  })
})
