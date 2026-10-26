import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Achado #10 (26/10): o evento de conexão que chega pelo webhook da loja aciona o monitor na hora, com o motivo. */

const aplicarEventoConexao = vi.fn(async () => 'caiu')
vi.mock('@/lib/whatsapp-monitor', () => ({ aplicarEventoConexao: (...a: unknown[]) => aplicarEventoConexao(...(a as [])) }))

const SEGREDO = 'a'.repeat(48)

function supabaseFalso() {
  const from = vi.fn((tabela: string) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) q[m] = () => q
    q.maybeSingle = async () => ({
      data: tabela === 'whatsapp_robo_config'
        ? { restaurante_id: 'loja-1', boas_vindas: '' }
        : tabela === 'restaurantes' ? { id: 'loja-1', nome: 'Loja', slug: 'loja', evolution_instance: 'inst-1', entrega_sem_entregador: false, usa_logistica: true } : null,
      error: null,
    })
    q.insert = async () => ({ error: null })
    return q
  })
  return { from, rpc: vi.fn() } as unknown as SupabaseClient
}

describe('webhook da loja: evento de conexão', () => {
  it('aciona o monitor da loja com estado e motivo, e não vira mensagem', async () => {
    const { processarEntrada } = await import('./entrada')
    const r = await processarEntrada(supabaseFalso(), SEGREDO, { event: 'connection.update', instance: 'inst-1', data: { state: 'close', statusReason: 401 } })
    expect(r.status).toBe(200)
    expect(aplicarEventoConexao).toHaveBeenCalledWith(expect.anything(), 'loja-1', { estado: 'close', motivo: 401 })
    expect(r.processadas).toBe(0)
  })
})
