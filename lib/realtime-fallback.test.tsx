import { describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useRealtimeComFallback, INTERVALO_REALTIME_OK, INTERVALO_FALLBACK } from './realtime-fallback'

/**
 * O caminho saudável foi medido em produção (60s exatos entre refetches). O que
 * não dá para provocar num navegador real sem derrubar a rede é a queda e a
 * volta do canal — é o que estes testes cobrem.
 */

type Callback = (status: string) => void

/** Canal de mentira que deixa o teste decidir quando o status muda. */
function supabaseFalso() {
  let notificar: Callback = () => {}
  const canal = {
    on: vi.fn(() => canal),
    subscribe: vi.fn((cb: Callback) => { notificar = cb; return canal }),
  }
  const supabase = {
    channel: vi.fn(() => canal),
    removeChannel: vi.fn(),
  } as unknown as SupabaseClient
  return { supabase, canal, mudarStatus: (s: string) => act(() => notificar(s)) }
}

function montar(supabase: SupabaseClient, aoSincronizar = vi.fn()) {
  const r = renderHook(() =>
    useRealtimeComFallback({
      supabase,
      canal: 'teste',
      tabelas: [{ tabela: 'pedidos', filtro: 'restaurante_id=eq.1' }],
      aoEvento: vi.fn(),
      aoSincronizar,
    })
  )
  return { ...r, aoSincronizar }
}

describe('useRealtimeComFallback', () => {
  it('começa no ritmo de fallback — antes de o canal confirmar, ninguém garante evento', () => {
    const { supabase } = supabaseFalso()
    const { result } = montar(supabase)
    expect(result.current.saudavel).toBe(false)
    expect(result.current.intervaloMs).toBe(INTERVALO_FALLBACK)
  })

  it('SUBSCRIBED afrouxa o polling para o heartbeat', async () => {
    const { supabase, mudarStatus } = supabaseFalso()
    const { result } = montar(supabase)
    mudarStatus('SUBSCRIBED')
    await waitFor(() => expect(result.current.saudavel).toBe(true))
    expect(result.current.intervaloMs).toBe(INTERVALO_REALTIME_OK)
  })

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])('%s devolve o polling ao ritmo agressivo', async (status) => {
    const { supabase, mudarStatus } = supabaseFalso()
    const { result } = montar(supabase)
    mudarStatus('SUBSCRIBED')
    await waitFor(() => expect(result.current.intervaloMs).toBe(INTERVALO_REALTIME_OK))

    mudarStatus(status)
    await waitFor(() => expect(result.current.saudavel).toBe(false))
    expect(result.current.intervaloMs).toBe(INTERVALO_FALLBACK)
  })

  it('cada (re)conexão dispara uma sincronização — é o que impede perder pedido da queda', async () => {
    const { supabase, mudarStatus } = supabaseFalso()
    const aoSincronizar = vi.fn()
    const { result } = montar(supabase, aoSincronizar)

    mudarStatus('SUBSCRIBED')
    await waitFor(() => expect(aoSincronizar).toHaveBeenCalledTimes(1))

    mudarStatus('CHANNEL_ERROR')
    await waitFor(() => expect(result.current.saudavel).toBe(false))
    expect(aoSincronizar).toHaveBeenCalledTimes(1) // cair não sincroniza

    mudarStatus('SUBSCRIBED')
    await waitFor(() => expect(aoSincronizar).toHaveBeenCalledTimes(2)) // voltar, sim
    expect(result.current.intervaloMs).toBe(INTERVALO_REALTIME_OK)
  })

  it('canal null não assina nada e mantém o fallback', () => {
    const { supabase } = supabaseFalso()
    const { result } = renderHook(() =>
      useRealtimeComFallback({
        supabase, canal: null, tabelas: [{ tabela: 'pedidos' }],
        aoEvento: vi.fn(), aoSincronizar: vi.fn(),
      })
    )
    expect(supabase.channel).not.toHaveBeenCalled()
    expect(result.current.intervaloMs).toBe(INTERVALO_FALLBACK)
  })

  it('desmontar remove o canal — não deixa conexão vazando entre remontagens', () => {
    const { supabase } = supabaseFalso()
    const { unmount } = montar(supabase)
    unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('assina uma vez por tabela declarada', () => {
    const { supabase, canal } = supabaseFalso()
    renderHook(() =>
      useRealtimeComFallback({
        supabase, canal: 'multi',
        tabelas: [{ tabela: 'pedidos' }, { tabela: 'entregadores' }, { tabela: 'nexta_entregas' }],
        aoEvento: vi.fn(), aoSincronizar: vi.fn(),
      })
    )
    expect(canal.on).toHaveBeenCalledTimes(3)
  })
})
