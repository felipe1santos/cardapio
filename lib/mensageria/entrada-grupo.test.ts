import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 15/11/2026: na reentrega da Evolution chegaram 740 webhooks só com mensagem de GRUPO da Gordelícia; cada um fazia
 * 3 consultas (config, loja, registro do evento) para no fim ser ignorado. Regra 2 das correções: evento externo que
 * sempre é descartado sai antes de tocar no banco.
 */
vi.mock('@/lib/whatsapp-monitor', () => ({ aplicarEventoConexao: vi.fn() }))

const SEGREDO = 'b'.repeat(48)

function contador() {
  const from = vi.fn(() => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'contains', 'limit', 'or']) q[m] = () => q
    q.maybeSingle = async () => ({ data: null, error: null })
    q.insert = async () => ({ error: null })
    return q
  })
  return { from, rpc: vi.fn(async () => ({ data: null, error: null })) }
}

const msg = (jid: string, id: string) => ({ key: { remoteJid: jid, id, fromMe: false }, message: { conversation: 'oi' }, messageTimestamp: Math.floor(Date.now() / 1000) })

describe('webhook da loja: grupo e difusão não consultam o banco', { timeout: 20_000 }, () => {
  it('lote só de grupo/status sai sem nenhuma consulta', async () => {
    const { processarEntrada } = await import('./entrada')
    const db = contador()
    const r = await processarEntrada(db as unknown as SupabaseClient, SEGREDO, {
      event: 'messages.upsert', instance: 'inst-1',
      data: [msg('123-456@g.us', 'A1'), msg('status@broadcast', 'A2')],
    })
    expect(r.status).toBe(200)
    expect(r.ignoradas).toEqual({ grupo: 1, difusao: 1 })
    expect(db.from).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('lote sem nada aproveitável (só reação/edição) também não consulta', async () => {
    const { processarEntrada } = await import('./entrada')
    const db = contador()
    const r = await processarEntrada(db as unknown as SupabaseClient, SEGREDO, {
      event: 'messages.upsert', instance: 'inst-1',
      data: [{ key: { remoteJid: '5521999990000@s.whatsapp.net', id: 'C1', fromMe: false }, message: { reactionMessage: { text: '👍' } }, messageType: 'reactionMessage' }],
    })
    expect(r.status).toBe(200)
    expect(db.from).not.toHaveBeenCalled()
  })

  it('lote com mensagem de cliente segue para o banco (procura a loja pelo segredo)', async () => {
    const { processarEntrada } = await import('./entrada')
    const db = contador()
    await processarEntrada(db as unknown as SupabaseClient, SEGREDO, {
      event: 'messages.upsert', instance: 'inst-1',
      data: [msg('123-456@g.us', 'B1'), msg('5521999990000@s.whatsapp.net', 'B2')],
    })
    expect(db.from).toHaveBeenCalledWith('whatsapp_robo_config')
  })
})
