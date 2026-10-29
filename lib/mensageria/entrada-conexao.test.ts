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

// Import de ./entrada é pesado (robô, IA, fila): com a máquina carregada passava dos 5 s padrão.
describe('webhook da loja: evento de conexão', { timeout: 20_000 }, () => {
  it('aciona o monitor da loja com estado e motivo, e não vira mensagem', async () => {
    const { processarEntrada } = await import('./entrada')
    const r = await processarEntrada(supabaseFalso(), SEGREDO, { event: 'connection.update', instance: 'inst-1', data: { state: 'close', statusReason: 401 } })
    expect(r.status).toBe(200)
    expect(aplicarEventoConexao).toHaveBeenCalledWith(expect.anything(), 'loja-1', { estado: 'close', motivo: 401 })
    expect(r.processadas).toBe(0)
  })

  it('27/10: o mesmo evento repetido em 60 s (Evolution oscilando) sai sem nenhuma consulta ao banco', async () => {
    const { processarEntrada } = await import('./entrada')
    aplicarEventoConexao.mockClear()
    const db = supabaseFalso()
    const corpo = { event: 'connection.update', instance: 'inst-1', data: { state: 'connecting', statusReason: 200 } }
    await processarEntrada(db, SEGREDO, corpo)
    const consultas = (db.from as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    for (let i = 0; i < 50; i++) await processarEntrada(db, SEGREDO, corpo)
    expect(aplicarEventoConexao).toHaveBeenCalledTimes(1)
    expect((db.from as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(consultas)
    // Estado diferente passa na hora.
    await processarEntrada(db, SEGREDO, { ...corpo, data: { state: 'open', statusReason: 200 } })
    expect(aplicarEventoConexao).toHaveBeenCalledTimes(2)
  })

  it('28/10: loja desconectada — eventos dela (qualquer estado e motivo) não consultam o banco; só o "open" passa', async () => {
    const { processarEntrada } = await import('./entrada')
    const S2 = 'b'.repeat(48)
    aplicarEventoConexao.mockClear().mockResolvedValueOnce('parado')
    const db = supabaseFalso()
    await processarEntrada(db, S2, { event: 'connection.update', instance: 'inst-1', data: { state: 'close', statusReason: 401 } })
    const consultas = (db.from as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    for (let i = 0; i < 100; i++) await processarEntrada(db, S2, { event: 'connection.update', instance: 'inst-1', data: { state: i % 2 ? 'close' : 'connecting', statusReason: 400 + i } })
    expect((db.from as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(consultas)
    expect(aplicarEventoConexao).toHaveBeenCalledTimes(1)
    await processarEntrada(db, S2, { event: 'connection.update', instance: 'inst-1', data: { state: 'open', statusReason: 200 } })
    expect(aplicarEventoConexao).toHaveBeenCalledTimes(2)
  })
})
