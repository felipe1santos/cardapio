import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _zerarGuarda } from './guarda'
import { chamarClaude, MODELO_IA, MAX_TOKENS_IA } from './anthropic'

/** Banco falso: gasto do dia (ia_uso_dia), guarda liberada. */
function banco(gastoLoja = 0) {
  const rpcs: string[] = []
  const admin = {
    rpc: vi.fn(async (fn: string) => {
      rpcs.push(fn)
      if (fn === 'api_uso_contar') return { data: { permitido: true, chamadas: 1, limite: 2000 }, error: null }
      return { data: null, error: null }
    }),
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          eq: (_c: string, escopo: string) => ({
            limit: async () => ({ data: t === 'ia_uso_dia' ? [{ custo_micro_usd: escopo === 'total' ? 0 : gastoLoja }] : [], error: null }),
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({}) }) }) }),
    }),
  }
  return { admin: admin as never, rpcs }
}

const PEDIDO = { system: [{ type: 'text' as const, text: 'regras' }], messages: [{ role: 'user' as const, content: 'oi' }] }
const OK = { content: [{ type: 'text', text: 'Olá!' }], stop_reason: 'end_turn', model: 'claude-haiku-5-5', usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 } }

beforeEach(() => { _zerarGuarda(); process.env.ANTHROPIC_API_KEY = 'sk-teste-nao-vaza' })
afterEach(() => { delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_BASE_URL })

describe('chamada ao Claude (sempre pela guarda)', () => {
  it('sem ANTHROPIC_API_KEY: não chama nada', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const f = vi.fn()
    expect(await chamarClaude(banco().admin, { loja: 'L', conversa: 'c' }, PEDIDO, { timeoutMs: 1000, fetch: f as never })).toMatchObject({ ok: false, motivo: 'sem_chave' })
    expect(f).not.toHaveBeenCalled()
  })

  it('teto da loja atingido: não chama a API', async () => {
    const f = vi.fn()
    expect(await chamarClaude(banco(500_000).admin, { loja: 'L', conversa: 'c' }, PEDIDO, { timeoutMs: 1000, fetch: f as never })).toMatchObject({ ok: false, motivo: 'teto' })
    expect(f).not.toHaveBeenCalled()
  })

  it('pedido com o modelo da constante, 400 tokens, esforço baixo, sem raciocínio e cache na parte fixa; custo com cache', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(OK), { status: 200 }))
    const b = banco()
    const r = await chamarClaude(b.admin, { loja: 'L', conversa: 'c' }, PEDIDO, { timeoutMs: 1000, fetch: f as never })
    expect(r).toMatchObject({ ok: true, resposta: { stop_reason: 'end_turn' } })
    if (r.ok) expect(r.custoMicroUsd).toBe(Math.ceil(50 * 0.1 + 10 * 0.5 + 1000 * 0.01))
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const corpo = JSON.parse(String(init.body))
    expect(corpo).toMatchObject({ model: MODELO_IA, max_tokens: MAX_TOKENS_IA, output_config: { effort: 'low' }, thinking: { type: 'disabled' } })
    expect(corpo.system.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    expect(corpo.temperature).toBeUndefined()
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-teste-nao-vaza')
    expect(b.rpcs).toContain('ia_uso_registrar')
  })

  it('erro da API (529, 500, 429): falha UMA vez, sem repetir, e a mensagem não leva a chave', async () => {
    for (const status of [529, 500, 429, 401]) {
      _zerarGuarda()
      const f = vi.fn(async () => new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status }))
      const r = await chamarClaude(banco().admin, { loja: 'L', conversa: `c${status}` }, PEDIDO, { timeoutMs: 1000, fetch: f as never })
      expect(r.ok, String(status)).toBe(false)
      expect(f).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(r)).not.toContain('sk-teste')
    }
  })

  it('tempo esgotado vira falha (o robô assume)', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise((_ok, erro) => init.signal?.addEventListener('abort', () => erro(new Error('abortado')))))
    const r = await chamarClaude(banco().admin, { loja: 'L', conversa: 'lento' }, PEDIDO, { timeoutMs: 30, fetch: f as never })
    expect(r).toMatchObject({ ok: false, motivo: 'erro' })
  })

  it('ANTHROPIC_BASE_URL só vale para servidor de teste local (nunca outro host)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(OK), { status: 200 }))
    process.env.ANTHROPIC_BASE_URL = 'https://outro-host.com'
    await chamarClaude(banco().admin, { loja: 'L', conversa: 'x1' }, PEDIDO, { timeoutMs: 1000, fetch: f as never })
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:4999'
    await chamarClaude(banco().admin, { loja: 'L', conversa: 'x2' }, PEDIDO, { timeoutMs: 1000, fetch: f as never })
    expect(f.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['https://api.anthropic.com/v1/messages', 'http://127.0.0.1:4999/v1/messages'])
  })

  it('Regra nº 1: a requisição à Anthropic só existe dentro de chamarIa', () => {
    const src = readFileSync(join(__dirname, 'anthropic.ts'), 'utf8')
    // Nenhum fetch( direto; a única requisição é o `buscar(` (fetch injetável), dentro do callback do chamarIa.
    expect(src.match(/\bfetch\(/g)).toBeNull()
    expect(src.match(/\bbuscar\(/g)?.length).toBe(1)
    const posFetch = src.indexOf('buscar(')
    const posChamarIa = src.indexOf('chamarIa(')
    expect(posChamarIa).toBeGreaterThan(-1)
    expect(posFetch).toBeGreaterThan(posChamarIa)
  })
})
