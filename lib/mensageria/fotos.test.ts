import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  precisaBuscar, reservarConsultas, obterFotos,
  VALIDADE_FOTO_MS, RENOVAR_QUEBRADA_MS, MAX_CONSULTAS_POR_MINUTO,
} from './fotos'
import type { ProvedorWhatsapp } from './provedor'

const H = 60 * 60_000
const iso = (msAtras: number, agora: number) => new Date(agora - msAtras).toISOString()

describe('quando consultar a foto de novo', () => {
  const agora = Date.parse('2026-09-29T12:00:00Z')
  it('nunca buscada → busca', () => expect(precisaBuscar(undefined, agora)).toBe(true))
  it('dentro dos 3 dias → usa a guardada (com ou sem foto)', () => {
    expect(precisaBuscar({ url: 'https://x/a.jpg', buscadaEm: iso(2 * 24 * H, agora) }, agora)).toBe(false)
    expect(precisaBuscar({ url: null, buscadaEm: iso(2 * 24 * H, agora) }, agora)).toBe(false)
  })
  it('venceu os 3 dias → busca', () => expect(precisaBuscar({ url: null, buscadaEm: iso(VALIDADE_FOTO_MS, agora) }, agora)).toBe(true))
  it('link quebrado na tela: só renova se tiver mais de 1 h', () => {
    expect(precisaBuscar({ url: 'https://x/a.jpg', buscadaEm: iso(10 * 60_000, agora) }, agora, true)).toBe(false)
    expect(precisaBuscar({ url: 'https://x/a.jpg', buscadaEm: iso(RENOVAR_QUEBRADA_MS, agora) }, agora, true)).toBe(true)
  })
})

describe('limite por loja', () => {
  it(`no máximo ${MAX_CONSULTAS_POR_MINUTO} consultas por minuto; a janela anda`, () => {
    const t = Date.parse('2026-09-29T12:00:00Z')
    expect(reservarConsultas('loja-lim', 25, t)).toBe(25)
    expect(reservarConsultas('loja-lim', 10, t + 1000)).toBe(5)
    expect(reservarConsultas('loja-lim', 1, t + 2000)).toBe(0)
    expect(reservarConsultas('loja-outra', 3, t + 2000)).toBe(3)
    expect(reservarConsultas('loja-lim', 10, t + 61_000)).toBe(10)
  })
})

// Supabase de mentira: só o que obterFotos usa.
function falso(conversas: string[], guardadas: { telefone: string; url: string | null; buscada_em: string }[]) {
  const gravados: unknown[] = []
  const consulta = (linhas: Record<string, unknown>[]) => {
    const q = {
      select: () => q, eq: () => q,
      in: (_c: string, vals: string[]) => Promise.resolve({ data: linhas.filter((l) => vals.includes(l.telefone as string)) }),
    }
    return q
  }
  const admin = {
    from: (t: string) => t === 'whatsapp_conversas'
      ? consulta(conversas.map((telefone) => ({ telefone })))
      : { ...consulta(guardadas), upsert: (l: unknown[]) => { gravados.push(...l); return Promise.resolve({ error: null }) } },
  } as unknown as SupabaseClient
  return { admin, gravados }
}
function provedor(resposta: (n: string) => { ok: true; url: string | null } | { ok: false }) {
  const chamadas: string[] = []
  let simultaneas = 0
  let pico = 0
  const p = {
    fotoDePerfil: async (_i: string, n: string) => {
      chamadas.push(n); simultaneas++; pico = Math.max(pico, simultaneas)
      await new Promise((r) => setTimeout(r, 5))
      simultaneas--
      return resposta(n)
    },
  } as unknown as ProvedorWhatsapp
  return { p, chamadas, pico: () => pico }
}

describe('obterFotos', () => {
  const tels = Array.from({ length: 14 }, (_, i) => `55279990000${String(i).padStart(2, '0')}`)

  it('no máximo 10 por pedido, 3 ao mesmo tempo, e só telefones desta loja', async () => {
    const { admin, gravados } = falso(tels.slice(0, 12), [])
    const pr = provedor((n) => ({ ok: true, url: `https://pps.whatsapp.net/${n}.jpg` }))
    const r = await obterFotos(admin, pr.p, 'loja-a', 'inst', [...tels, '5511000000000'])
    expect(pr.chamadas.length).toBe(10)
    expect(pr.pico()).toBeLessThanOrEqual(3)
    expect(Object.keys(r).length).toBe(10)
    expect(gravados.length).toBe(10)
  })

  it('usa o cache válido sem consultar o WhatsApp', async () => {
    const agora = Date.now()
    const { admin } = falso(tels.slice(0, 2), [{ telefone: tels[0], url: 'https://x/0.jpg', buscada_em: iso(H, agora) }, { telefone: tels[1], url: null, buscada_em: iso(H, agora) }])
    const pr = provedor(() => ({ ok: true, url: 'https://novo' }))
    const r = await obterFotos(admin, pr.p, 'loja-b', 'inst', tels.slice(0, 2))
    expect(pr.chamadas.length).toBe(0)
    expect(r).toEqual({ [tels[0]]: 'https://x/0.jpg', [tels[1]]: null })
  })

  it('falha na consulta: mantém o que tinha e marca para tentar de novo em 1 h', async () => {
    const { admin, gravados } = falso([tels[0]], [])
    const pr = provedor(() => ({ ok: false }))
    const r = await obterFotos(admin, pr.p, 'loja-c', 'inst', [tels[0]])
    expect(r[tels[0]]).toBeNull()
    const g = gravados[0] as { buscada_em: string }
    const idade = Date.now() - Date.parse(g.buscada_em)
    expect(idade).toBeGreaterThan(VALIDADE_FOTO_MS - 2 * H)
    expect(precisaBuscar({ url: null, buscadaEm: g.buscada_em }, Date.now())).toBe(false)
    expect(precisaBuscar({ url: null, buscadaEm: g.buscada_em }, Date.now() + H + 1000)).toBe(true)
  })

  it('WhatsApp da loja desconectado: não consulta nada', async () => {
    const { admin } = falso([tels[0]], [])
    const pr = provedor(() => ({ ok: true, url: 'https://x' }))
    const r = await obterFotos(admin, pr.p, 'loja-d', null, [tels[0]])
    expect(pr.chamadas.length).toBe(0)
    expect(r).toEqual({ [tels[0]]: null })
  })
})
