import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarPedidosPorIds, PEDIDO_SELECT } from './pedidos'

/** Achado #5 (25/10): o evento do Kanban busca só os pedidos que mudaram, no mesmo formato da lista. */

function supabaseFalso(linhas: Record<string, unknown>[], erro: unknown = null) {
  const chamadas: [string, ...unknown[]][] = []
  const q = {
    select: vi.fn((...a: unknown[]) => { chamadas.push(['select', ...a]); return q }),
    eq: vi.fn((...a: unknown[]) => { chamadas.push(['eq', ...a]); return q }),
    in: vi.fn((...a: unknown[]) => { chamadas.push(['in', ...a]); return Promise.resolve({ data: linhas, error: erro }) }),
  }
  return { supabase: { from: vi.fn(() => q) } as unknown as SupabaseClient, chamadas }
}

const linha = { id: 'p1', numero: 7, tipo: 'entrega', status: 'preparando', criado_em: '2026-10-25T19:00:00Z', atualizado_em: '2026-10-25T19:05:00Z', pedido_itens: [] }

describe('buscarPedidosPorIds', () => {
  it('busca só os ids pedidos, da loja, com o select completo do Kanban', async () => {
    const { supabase, chamadas } = supabaseFalso([linha])
    const r = await buscarPedidosPorIds(supabase, 'loja1', ['p1', 'p2'])
    expect(chamadas).toEqual([['select', PEDIDO_SELECT], ['eq', 'restaurante_id', 'loja1'], ['in', 'id', ['p1', 'p2']]])
    expect(r.map((p) => [p.id, p.status])).toEqual([['p1', 'preparando']])
  })

  it('lista vazia não consulta', async () => {
    const { supabase } = supabaseFalso([])
    expect(await buscarPedidosPorIds(supabase, 'loja1', [])).toEqual([])
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('erro do banco é lançado (não vira "pedido sumiu")', async () => {
    const { supabase } = supabaseFalso([], { message: 'falhou' })
    await expect(buscarPedidosPorIds(supabase, 'loja1', ['p1'])).rejects.toBeTruthy()
  })
})
