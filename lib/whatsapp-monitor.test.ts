import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { aplicarEventoConexao, decidirMonitor, deveVigiar, MAX_TENTATIVAS, THROTTLE_MS } from './whatsapp-monitor'

/**
 * Regra do dono (28/10/2026): WhatsApp é OPCIONAL. Loja desconectada (manual, 401 deslogou no celular, 440 sessão aberta
 * em outro lugar, ou queda que não voltou em 3 tentativas) fica DESCONECTADA em silêncio — sem reconectar, sem conferir,
 * sem aviso repetido — até o dono ler o QR de novo. Super Admin: 1 aviso só, quando uma loja que estava em uso cai sozinha.
 */
const agora = Date.parse('2026-10-28T20:00:00Z')
const iso = (min: number) => new Date(agora - min * 60_000).toISOString()
const base = { anterior: 'open' as string | null, novo: 'close' as 'close' | 'open' | 'connecting' | null, caiuEm: null as string | null, manualEm: null as string | null, motivo: null as number | string | null, tentativas: 0, agora }

describe('monitor do WhatsApp: decisão', () => {
  it('queda momentânea de loja em uso: tenta reconectar (1ª de 3), sem aviso ainda', () => {
    const d = decidirMonitor({ ...base, novo: 'close', motivo: 503 })
    expect(d).toMatchObject({ estado: 'connecting', reconectar: true, avisarSuperadmin: false, voltou: false })
    expect(d.caiuEm).toBe(new Date(agora).toISOString())
  })
  it(`${MAX_TENTATIVAS} tentativas sem voltar: desconectada em silêncio + 1 aviso ao Super Admin`, () => {
    const d = decidirMonitor({ ...base, anterior: 'connecting', novo: 'connecting', caiuEm: iso(6), tentativas: MAX_TENTATIVAS })
    expect(d).toMatchObject({ estado: 'close', reconectar: false, avisarSuperadmin: true, caiuEm: iso(6) })
  })
  it('401 (deslogou no celular) e 440 (aberta em outro lugar): desconectada na hora, SEM reconectar; 1 aviso', () => {
    for (const motivo of [401, 440, '440']) {
      expect(decidirMonitor({ ...base, motivo })).toMatchObject({ estado: 'close', reconectar: false, avisarSuperadmin: true })
    }
  })
  it('desconexão pelo painel (manual): desconectada, sem reconectar e SEM aviso', () => {
    expect(decidirMonitor({ ...base, manualEm: iso(1) })).toMatchObject({ estado: 'close', reconectar: false, avisarSuperadmin: false })
    // O close do logout pode chegar minutos depois do clique.
    expect(decidirMonitor({ ...base, manualEm: iso(20), motivo: 401 })).toMatchObject({ estado: 'close', avisarSuperadmin: false })
  })
  it('loja que já estava desconectada: nada muda (sem reconectar, sem aviso de novo)', () => {
    expect(decidirMonitor({ ...base, anterior: 'close', novo: 'close', caiuEm: iso(9000) })).toMatchObject({ estado: 'close', reconectar: false, avisarSuperadmin: false, mudou: false })
    expect(decidirMonitor({ ...base, anterior: 'close', novo: 'connecting', caiuEm: iso(9000) })).toMatchObject({ estado: 'close', reconectar: false, avisarSuperadmin: false, mudou: false })
  })
  it('voltou (o dono leu o QR, ou a reconexão deu certo): conectada, limpa a queda, reenvia avisos', () => {
    expect(decidirMonitor({ ...base, anterior: 'close', novo: 'open', caiuEm: iso(30) })).toMatchObject({ estado: 'open', caiuEm: null, voltou: true, mudou: true })
    expect(decidirMonitor({ ...base, anterior: 'open', novo: 'open' })).toMatchObject({ estado: 'open', voltou: false, mudou: false })
  })
  it('loja que nunca esteve conectada e responde close: desconectada em silêncio (sem tentar, sem aviso)', () => {
    expect(decidirMonitor({ ...base, anterior: null, novo: 'close' })).toMatchObject({ estado: 'close', reconectar: false, avisarSuperadmin: false })
  })
  it('Evolution sem resposta (null): não muda nada', () => {
    expect(decidirMonitor({ ...base, novo: null })).toMatchObject({ estado: 'open', reconectar: false, mudou: false })
  })
})

describe('quem o cron confere', () => {
  it('só loja conectada, em reconexão ou nunca conferida — desconectada e sem instância ficam de fora', () => {
    expect(deveVigiar('open')).toBe(true)
    expect(deveVigiar('connecting')).toBe(true)
    expect(deveVigiar(null)).toBe(true)
    expect(deveVigiar('close')).toBe(false)
    expect(deveVigiar('sem_instancia')).toBe(false)
  })
  it('throttle de 2 min por loja', () => { expect(THROTTLE_MS).toBe(120_000) })
})

/**
 * 01/11/2026 (Fase 2 da auditoria de infraestrutura): o evento técnico de conexão NÃO entra em `eventos_auditoria`
 * (tabela encadeada por hash, guardada para sempre); vai para `whatsapp_eventos` (metadado, 90 dias). Em 27/10 foram
 * 70 mil linhas na auditoria da PONTO 400 — e qualquer limpeza delas quebraria a cadeia.
 */
function adminFalso(loja: Record<string, unknown>) {
  const inseridos: { tabela: string; linha: Record<string, unknown> }[] = []
  const resposta = { data: null, error: null }
  const cadeia = (tabela: string) => {
    const c: Record<string, unknown> = {}
    const self = () => c
    for (const m of ['select', 'eq', 'is', 'gte', 'not', 'or', 'in', 'order', 'limit', 'update']) c[m] = self
    c.maybeSingle = async () => ({ data: tabela === 'restaurantes' ? loja : null, error: null })
    c.insert = (linha: Record<string, unknown>) => { inseridos.push({ tabela, linha }); return { ...c, then: (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok) } }
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok)
    return c
  }
  return { admin: { from: cadeia } as unknown as SupabaseClient, inseridos }
}

describe('evento de conexão do webhook (01/11): metadado em whatsapp_eventos, nunca na auditoria encadeada', () => {
  it('"connecting" numa loja conectada grava 1 linha em whatsapp_eventos com estado e motivo, e nada em eventos_auditoria', async () => {
    const { admin, inseridos } = adminFalso({ id: 'r1', nome: 'Ponto 400', evolution_instance: 'inst', whatsapp_estado: 'open', whatsapp_estado_em: iso(10), whatsapp_caiu_em: null, whatsapp_alertado_em: null, whatsapp_desconexao_manual_em: null })
    await aplicarEventoConexao(admin, 'r1', { estado: 'connecting', motivo: 428 })
    expect(inseridos.filter((i) => i.tabela === 'eventos_auditoria')).toEqual([])
    const ev = inseridos.filter((i) => i.tabela === 'whatsapp_eventos')
    expect(ev).toHaveLength(1)
    expect(ev[0].linha).toMatchObject({ restaurante_id: 'r1', tipo: 'conexao', resultado: { estado: 'connecting', motivo: 428 } })
  })
})
