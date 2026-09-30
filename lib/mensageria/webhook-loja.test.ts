import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { corpoWebhook, decidirWebhook, garantirWebhookDaLoja } from './webhook-loja'

const NOSSA = 'https://app.menuzia.com.br/api/whatsapp/webhook/abc123'

describe('decidirWebhook', () => {
  it('sem webhook: registra', () => {
    expect(decidirWebhook(null, NOSSA)).toBe('registrar')
    expect(decidirWebhook({ url: '' }, NOSSA)).toBe('registrar')
  })
  it('já é o nosso, com os dois eventos: não mexe', () => {
    expect(decidirWebhook({ url: NOSSA, enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] }, NOSSA)).toBe('ja_estava')
  })
  it('nosso host mas faltando evento, segredo antigo ou desligado: registra de novo', () => {
    expect(decidirWebhook({ url: NOSSA, enabled: true, events: ['MESSAGES_UPSERT'] }, NOSSA)).toBe('registrar')
    expect(decidirWebhook({ url: 'https://app.menuzia.com.br/api/whatsapp/webhook/velho', enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] }, NOSSA)).toBe('registrar')
    expect(decidirWebhook({ url: NOSSA, enabled: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] }, NOSSA)).toBe('registrar')
  })
  it('webhook ativo de outro uso (outro host): nunca sobrescreve', () => {
    expect(decidirWebhook({ url: 'https://n8n.exemplo.com/webhook/x', enabled: true, events: ['MESSAGES_UPSERT'] }, NOSSA)).toBe('outro_uso')
  })
  it('corpo: nossa URL, sem base64, só os dois eventos', () => {
    expect(corpoWebhook(NOSSA)).toEqual({ webhook: { enabled: true, url: NOSSA, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } })
  })
})

describe('garantirWebhookDaLoja', () => {
  const env = { ...process.env }
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'https://evo.teste'
    process.env.EVOLUTION_API_KEY = 'k'
    delete process.env.WHATSAPP_PROVEDOR
  })
  afterEach(() => { process.env = { ...env } })

  const banco = (instancia: string | null) => ({
    from: (t: string) => {
      const b: Record<string, unknown> = { select: () => b, eq: () => b, upsert: () => b,
        maybeSingle: async () => ({ data: t === 'restaurantes' ? { evolution_instance: instancia } : { webhook_segredo: 'abc123' }, error: null }) }
      return b
    },
  }) as unknown as SupabaseClient

  it('instância da loja (do banco) recebe o webhook com o segredo da loja', async () => {
    const chamadas: [string, RequestInit | undefined][] = []
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      chamadas.push([url, init])
      return new Response(url.includes('/find/') ? 'null' : '{}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await garantirWebhookDaLoja(banco('menuzia-loja-a'), 'r1', f)).toBe('registrado')
    expect(chamadas[1][0]).toBe('https://evo.teste/webhook/set/menuzia-loja-a')
    expect(JSON.parse(String(chamadas[1][1]?.body)).webhook.url).toBe(NOSSA)
  })

  it('loja sem instância: nada a fazer', async () => {
    const f = vi.fn() as unknown as typeof fetch
    expect(await garantirWebhookDaLoja(banco(null), 'r1', f)).toBe('sem_instancia')
    expect(f).not.toHaveBeenCalled()
  })

  it('provedor simulado (testes locais): não fala com a Evolution', async () => {
    process.env.WHATSAPP_PROVEDOR = 'simulado'
    const f = vi.fn() as unknown as typeof fetch
    expect(await garantirWebhookDaLoja(banco('x'), 'r1', f)).toBe('simulado')
    expect(f).not.toHaveBeenCalled()
  })
})
