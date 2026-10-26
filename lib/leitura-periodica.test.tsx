import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLeituraPeriodica } from './leitura-periodica'

/**
 * Revisão de escala (26/10): os avisos globais do painel (WhatsApp, impressão, caixa) liam a cada 60 s mesmo com a aba
 * escondida — o PC da cozinha fica o dia todo assim. Agora: pausa escondida e lê na hora ao voltar.
 */

let visivel = true
function mudarVisibilidade(v: boolean) {
  visivel = v
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

describe('useLeituraPeriodica', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visivel = true
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (visivel ? 'visible' : 'hidden'))
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('lê ao montar e a cada intervalo com a aba visível', () => {
    const ler = vi.fn()
    renderHook(() => useLeituraPeriodica(ler, 60_000))
    expect(ler).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(ler).toHaveBeenCalledTimes(3)
  })

  it('aba escondida: não lê; ao voltar, lê na hora', () => {
    const ler = vi.fn()
    renderHook(() => useLeituraPeriodica(ler, 60_000))
    mudarVisibilidade(false)
    act(() => { vi.advanceTimersByTime(600_000) })
    expect(ler).toHaveBeenCalledTimes(1)
    mudarVisibilidade(true)
    expect(ler).toHaveBeenCalledTimes(2)
  })

  it('desmontar para tudo', () => {
    const ler = vi.fn()
    const { unmount } = renderHook(() => useLeituraPeriodica(ler, 60_000))
    unmount()
    act(() => { vi.advanceTimersByTime(300_000) })
    expect(ler).toHaveBeenCalledTimes(1)
  })
})
