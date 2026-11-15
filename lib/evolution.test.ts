import { describe, expect, it } from 'vitest'
import { nomeInstancia } from './evolution'

describe('nome de instância nova do WhatsApp', () => {
  it('é aleatório e não carrega o id da loja', () => {
    const a = nomeInstancia()
    const b = nomeInstancia()
    expect(a).toMatch(/^menuzia-[0-9a-f]{24}$/)
    expect(a).not.toBe(b)
  })
})

describe('instância nova ignora grupos (15/11)', () => {
  it('a criação já pede groupsIgnore: o Menuzia nunca usa grupo e cada mensagem de grupo era trabalho à toa', async () => {
    const { vi } = await import('vitest')
    process.env.EVOLUTION_API_URL = 'http://evo.test'
    process.env.EVOLUTION_API_KEY = 'k'
    const corpos: unknown[] = []
    const antes = globalThis.fetch
    globalThis.fetch = vi.fn(async (_u: unknown, init?: RequestInit) => {
      if (init?.body) corpos.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ qrcode: { base64: 'x' } }), { status: 201 })
    }) as unknown as typeof fetch
    try {
      const { obterQrCode } = await import('./evolution')
      await obterQrCode('menuzia-abc')
    } finally { globalThis.fetch = antes }
    expect(corpos[0]).toMatchObject({ instanceName: 'menuzia-abc', groupsIgnore: true })
  })
})
