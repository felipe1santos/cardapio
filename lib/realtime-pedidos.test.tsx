import { describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { abrirCanalPedidos, CanalPedidosContexto, useEventosPedidos, type CanalPedidos } from './realtime-pedidos'
import { useRealtimeComFallback, INTERVALO_REALTIME_OK } from './realtime-fallback'

/**
 * Achado #6 da auditoria (25/10): numa aba do Kanban havia 3 canais na mesma tabela `pedidos` (contadores do menu, alarme,
 * Kanban; 4 com o Despacho), e cada mudança custava ~11 requisições. Aqui: UM canal de `pedidos` por aba, aberto no layout
 * e repassado por contexto.
 */

type Status = (s: string) => void
type Ouvinte = (payload: unknown) => void

/** Supabase de mentira que registra cada canal aberto e deixa o teste emitir eventos e mudar o status. */
function supabaseFalso() {
  const canais: { nome: string; ouvintes: { tabela: string; filtro?: string; cb: Ouvinte }[]; status: Status }[] = []
  const supabase = {
    channel: vi.fn((nome: string) => {
      const c = { nome, ouvintes: [] as { tabela: string; filtro?: string; cb: Ouvinte }[], status: (() => {}) as Status }
      canais.push(c)
      const api = {
        on: vi.fn((_t: string, f: { table: string; filter?: string }, cb: Ouvinte) => { c.ouvintes.push({ tabela: f.table, filtro: f.filter, cb }); return api }),
        subscribe: vi.fn((cb?: Status) => { if (cb) c.status = cb; return api }),
      }
      return api
    }),
    removeChannel: vi.fn(),
  } as unknown as SupabaseClient
  const emitir = (tabela: string, payload: Record<string, unknown>) =>
    act(() => { for (const c of canais) for (const o of c.ouvintes) if (o.tabela === tabela) o.cb({ table: tabela, ...payload }) })
  const status = (s: string) => act(() => { for (const c of canais) c.status(s) })
  return { supabase, canais, emitir, status }
}

const evento = { eventType: 'UPDATE', new: { id: 'p1', status: 'preparando' }, old: { id: 'p1' } }

describe('abrirCanalPedidos — um canal de pedidos por aba', () => {
  it('abre UM canal filtrado pela loja, não importa quantos ouvintes', () => {
    const { supabase, canais } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    canal.ouvir(vi.fn())
    canal.ouvir(vi.fn())
    canal.ouvir(vi.fn())
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    expect(canais[0].ouvintes).toEqual([{ tabela: 'pedidos', filtro: 'restaurante_id=eq.loja1', cb: expect.any(Function) }])
  })

  it('entrega cada evento a todos os ouvintes', () => {
    const { supabase, emitir } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    const a = vi.fn()
    const b = vi.fn()
    canal.ouvir(a)
    canal.ouvir(b)
    emitir('pedidos', evento)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    expect(a.mock.calls[0][0]).toMatchObject({ eventType: 'UPDATE', new: { id: 'p1' } })
  })

  it('quem sai para de receber', () => {
    const { supabase, emitir } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    const a = vi.fn()
    const sair = canal.ouvir(a)
    sair()
    emitir('pedidos', evento)
    expect(a).not.toHaveBeenCalled()
  })

  it('(re)conexão avisa cada ouvinte para sincronizar e a saúde acompanha o status', () => {
    const { supabase, status } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    const sinc = vi.fn()
    canal.ouvir(vi.fn(), sinc)
    expect(canal.saudavel()).toBe(false)
    status('SUBSCRIBED')
    expect(sinc).toHaveBeenCalledTimes(1)
    expect(canal.saudavel()).toBe(true)
    status('CHANNEL_ERROR')
    expect(canal.saudavel()).toBe(false)
    expect(sinc).toHaveBeenCalledTimes(1)
  })

  it('fechar remove o canal', () => {
    const { supabase } = supabaseFalso()
    abrirCanalPedidos(supabase, 'loja1').fechar()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })
})

function comCanal(canal: CanalPedidos) {
  return function ComCanal({ children }: { children: ReactNode }) {
    return <CanalPedidosContexto.Provider value={canal}>{children}</CanalPedidosContexto.Provider>
  }
}

describe('useRealtimeComFallback dentro do layout', () => {
  it('a tabela pedidos da mesma loja vai pelo canal compartilhado: nenhum canal novo', async () => {
    const { supabase, emitir, status } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    const aoEvento = vi.fn()
    const aoSincronizar = vi.fn()
    const { result } = renderHook(
      () => useRealtimeComFallback({ supabase, canal: 'kds-loja1', tabelas: [{ tabela: 'pedidos', filtro: 'restaurante_id=eq.loja1' }], aoEvento, aoSincronizar }),
      { wrapper: comCanal(canal) },
    )
    expect(supabase.channel).toHaveBeenCalledTimes(1) // só o do layout
    status('SUBSCRIBED')
    await waitFor(() => expect(result.current.intervaloMs).toBe(INTERVALO_REALTIME_OK))
    expect(aoSincronizar).toHaveBeenCalled()
    emitir('pedidos', evento)
    expect(aoEvento).toHaveBeenCalledTimes(1)
  })

  it('as outras tabelas continuam num canal próprio, sem pedidos', () => {
    const { supabase, canais } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    renderHook(
      () => useRealtimeComFallback({
        supabase, canal: 'kanban-loja1',
        tabelas: [{ tabela: 'pedidos', filtro: 'restaurante_id=eq.loja1' }, { tabela: 'entregas_provedor', filtro: 'restaurante_id=eq.loja1' }],
        aoEvento: vi.fn(), aoSincronizar: vi.fn(),
      }),
      { wrapper: comCanal(canal) },
    )
    expect(supabase.channel).toHaveBeenCalledTimes(2)
    expect(canais[1].ouvintes.map((o) => o.tabela)).toEqual(['entregas_provedor'])
  })

  it('pedidos com outro filtro (ex.: uma comanda) não usa o compartilhado', () => {
    const { supabase, canais } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    renderHook(
      () => useRealtimeComFallback({ supabase, canal: 'conta-c1', tabelas: [{ tabela: 'pedidos', filtro: 'comanda_id=eq.c1' }], aoEvento: vi.fn(), aoSincronizar: vi.fn() }),
      { wrapper: comCanal(canal) },
    )
    expect(canais[1].ouvintes.map((o) => o.filtro)).toEqual(['comanda_id=eq.c1'])
  })
})

describe('layout ainda abrindo o canal (contexto null)', () => {
  const carregando = ({ children }: { children: ReactNode }) => <CanalPedidosContexto.Provider value={null}>{children}</CanalPedidosContexto.Provider>

  it('useEventosPedidos espera: não abre canal próprio por um instante', () => {
    const { supabase } = supabaseFalso()
    renderHook(() => useEventosPedidos({ supabase, restauranteId: 'loja1', aoEvento: vi.fn() }), { wrapper: carregando })
    expect(supabase.channel).not.toHaveBeenCalled()
  })

  it('useRealtimeComFallback espera a tabela pedidos e assina só as outras', () => {
    const { supabase, canais } = supabaseFalso()
    renderHook(
      () => useRealtimeComFallback({
        supabase, canal: 'kanban-loja1',
        tabelas: [{ tabela: 'pedidos', filtro: 'restaurante_id=eq.loja1' }, { tabela: 'entregas_provedor', filtro: 'restaurante_id=eq.loja1' }],
        aoEvento: vi.fn(), aoSincronizar: vi.fn(),
      }),
      { wrapper: carregando },
    )
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    expect(canais[0].ouvintes.map((o) => o.tabela)).toEqual(['entregas_provedor'])
  })
})

describe('canal do layout ficando pronto depois da tela (medido em produção, 26/10)', () => {
  it('o canal próprio (corridas/solicitações) não é derrubado e recriado — sem sincronização extra', async () => {
    const { supabase, canais, status } = supabaseFalso()
    const aoSincronizar = vi.fn()
    let valor: CanalPedidos | null = null
    const Wrapper = ({ children }: { children: ReactNode }) => <CanalPedidosContexto.Provider value={valor}>{children}</CanalPedidosContexto.Provider>
    const tabelas = [{ tabela: 'pedidos', filtro: 'restaurante_id=eq.loja1' }, { tabela: 'entregas_provedor', filtro: 'restaurante_id=eq.loja1' }]
    const { rerender } = renderHook(
      () => useRealtimeComFallback({ supabase, canal: 'kanban-loja1', tabelas, aoEvento: vi.fn(), aoSincronizar }),
      { wrapper: Wrapper },
    )
    status('SUBSCRIBED')
    // Layout termina de abrir o canal de pedidos.
    valor = abrirCanalPedidos(supabase, 'loja1')
    rerender()
    const proprios = canais.filter((c) => c.nome === 'kanban-loja1')
    expect(proprios).toHaveLength(1)
    expect(supabase.removeChannel).not.toHaveBeenCalled()
  })
})

describe('useEventosPedidos', () => {
  it('dentro do layout usa o canal compartilhado', () => {
    const { supabase, emitir } = supabaseFalso()
    const canal = abrirCanalPedidos(supabase, 'loja1')
    const aoEvento = vi.fn()
    renderHook(() => useEventosPedidos({ supabase, restauranteId: 'loja1', aoEvento }), { wrapper: comCanal(canal) })
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    emitir('pedidos', evento)
    expect(aoEvento).toHaveBeenCalledTimes(1)
  })

  it('fora do layout abre o próprio canal e fecha ao desmontar', () => {
    const { supabase, emitir } = supabaseFalso()
    const aoEvento = vi.fn()
    const { unmount } = renderHook(() => useEventosPedidos({ supabase, restauranteId: 'loja1', aoEvento }))
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    emitir('pedidos', evento)
    expect(aoEvento).toHaveBeenCalledTimes(1)
    unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('sem loja não assina nada', () => {
    const { supabase } = supabaseFalso()
    renderHook(() => useEventosPedidos({ supabase, restauranteId: null, aoEvento: vi.fn() }))
    expect(supabase.channel).not.toHaveBeenCalled()
  })
})
