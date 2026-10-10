import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarGuarda, chamarApiPaga, DISPARO_MAX, limiteDiario, nivelDoUso, registrarDisparo } from './guarda'
import { decidirFrete } from '@/lib/frete'
import { cacheValido, chaveEndereco, geocodificar } from '@/lib/geocode/geocodificar'

/** Supabase falso: api_uso_contar com limite de verdade, inserts guardados. */
function bancoFalso(limite: number) {
  let chamadas = 0
  const inseridos: Record<string, unknown[]> = {}
  const cache = new Map<string, Record<string, unknown>>()
  const admin = {
    rpc: vi.fn(async (_fn: string, p: { p_limite: number }) => {
      if (chamadas >= Math.min(limite, p.p_limite)) return { data: { permitido: false, chamadas, limite }, error: null }
      chamadas++
      return { data: { permitido: true, chamadas, limite }, error: null }
    }),
    from: (t: string) => ({
      insert: async (v: unknown) => { (inseridos[t] ??= []).push(v); return { error: null } },
      upsert: async (v: Record<string, unknown>) => { cache.set(v.chave as string, v); return { error: null } },
      select: () => ({ eq: (_c: string, chave: string) => ({ maybeSingle: async () => ({ data: cache.get(chave) ?? null }) }) }),
    }),
  }
  return { admin: admin as never, inseridos, cache, get chamadas() { return chamadas } }
}

beforeEach(() => _zerarGuarda())

describe('guarda de custo: limite diário', () => {
  it('chama até o limite e depois para (usa a reserva), com alerta de bloqueio', async () => {
    const b = bancoFalso(3)
    const fn = vi.fn(async () => 'ok')
    const r = []
    for (let i = 0; i < 5; i++) r.push(await chamarApiPaga(b.admin, { api: 'geocoding', chave: `end-${i}` }, fn))
    expect(r.map((x) => x.ok)).toEqual([true, true, true, false, false])
    expect(fn).toHaveBeenCalledTimes(3)
    expect(r[3]).toEqual({ ok: false, motivo: 'limite' })
    expect(b.inseridos.api_alertas?.some((a) => (a as { nivel: string }).nivel === 'bloqueio')).toBe(true)
  })
  it('alerta ao cruzar 80%', () => {
    expect(nivelDoUso(240, 300)).toBe('atencao')
    expect(nivelDoUso(239, 300)).toBe('normal')
    expect(nivelDoUso(241, 300)).toBe('normal') // só uma vez
  })
  it('limites vêm do Coolify, com padrão seguro', () => {
    expect(limiteDiario('geocoding', {})).toBe(300)
    expect(limiteDiario('directions', { LIMITE_DIRECTIONS_DIA: '50' })).toBe(50)
    expect(limiteDiario('geocoding', { LIMITE_GEOCODING_DIA: 'abc' })).toBe(300)
  })
  it('banco fora do ar: NÃO chama a API', async () => {
    const admin = { rpc: async () => ({ data: null, error: { message: 'fora' } }), from: () => ({ insert: async () => ({}) }) } as never
    const fn = vi.fn(async () => 'ok')
    expect(await chamarApiPaga(admin, { api: 'geocoding', chave: 'x' }, fn)).toEqual({ ok: false, motivo: 'banco' })
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('guarda de custo: bloqueio de loop (disparo)', () => {
  it(`a mesma chamada mais de ${DISPARO_MAX} vezes em 1 minuto é bloqueada`, async () => {
    const b = bancoFalso(10_000)
    const fn = vi.fn(async () => 'ok')
    const r = []
    for (let i = 0; i < DISPARO_MAX + 5; i++) r.push(await chamarApiPaga(b.admin, { api: 'geocoding', chave: 'rua x 55' }, fn))
    expect(fn).toHaveBeenCalledTimes(DISPARO_MAX)
    expect(r[DISPARO_MAX]).toEqual({ ok: false, motivo: 'disparo' })
    expect(b.inseridos.api_alertas?.some((a) => (a as { nivel: string }).nivel === 'disparo')).toBe(true)
  })
  it('janela de 1 minuto: depois dela libera de novo', () => {
    const m = new Map<string, number[]>()
    for (let i = 0; i < DISPARO_MAX; i++) expect(registrarDisparo(m, 'k', 1000 + i)).toBe(false)
    expect(registrarDisparo(m, 'k', 2000)).toBe(true)
    expect(registrarDisparo(m, 'k', 2000 + 61_000)).toBe(false)
  })
})

describe('cache de geocodificação: sucesso e falha', () => {
  it('endereço normalizado (acento, caixa, pontuação)', () => {
    expect(chaveEndereco('Rua São João, 55 - Centro, Vila Velha/ES')).toBe('rua sao joao 55 centro vila velha es')
  })
  it('falha vale até expirar; sucesso vale sempre', () => {
    const agora = Date.parse('2026-10-10T12:00:00Z')
    expect(cacheValido({ ok: true, expira_em: null }, agora)).toBe(true)
    expect(cacheValido({ ok: false, expira_em: '2026-10-11T11:00:00Z' }, agora)).toBe(true)
    expect(cacheValido({ ok: false, expira_em: '2026-10-10T11:00:00Z' }, agora)).toBe(false)
    expect(cacheValido(null, agora)).toBe(false)
  })
  it('"não encontrado" é guardado por 24 h e não consulta o Google de novo', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'teste'
    const b = bancoFalso(100)
    const fetchOrig = globalThis.fetch
    const f = vi.fn(async () => new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] })))
    globalThis.fetch = f as never
    try {
      expect(await geocodificar(b.admin, 'Rua Inexistente 999, Lugar Nenhum', null)).toEqual({ coord: null, motivo: 'nao_encontrado' })
      expect(await geocodificar(b.admin, 'Rua Inexistente 999, Lugar Nenhum', null)).toEqual({ coord: null, motivo: 'nao_encontrado' })
      expect(f).toHaveBeenCalledTimes(1)
      const linha = b.cache.get(chaveEndereco('Rua Inexistente 999, Lugar Nenhum'))!
      expect(linha.ok).toBe(false)
      expect(Date.parse(linha.expira_em as string) - Date.now()).toBeGreaterThan(23 * 3_600_000)
    } finally { globalThis.fetch = fetchOrig; delete process.env.GOOGLE_MAPS_SERVER_KEY }
  })
  it('sem a chave de servidor não chama o Google (indisponível → reserva)', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY
    const b = bancoFalso(100)
    expect(await geocodificar(b.admin, 'Rua A 1, Centro', null)).toEqual({ coord: null, motivo: 'indisponivel' })
    expect(b.chamadas).toBe(0)
  })
})

describe('reserva do frete quando o Google está bloqueado', () => {
  const base = { bairros: [{ bairro: 'Centro', taxa: 5 }], raios: [{ ateKm: 3, taxa: 4 }, { ateKm: 6, taxa: 8 }], distanciaKm: null }
  it('bairro cadastrado continua valendo', () => {
    expect(decidirFrete({ ...base, bairroCliente: 'Centro', taxaPadrao: 7, geocodeIndisponivel: true })).toMatchObject({ entregavel: true, taxa: 5, fonte: 'bairro' })
  })
  it('fora da lista: taxa fixa da loja, sem travar o checkout', () => {
    expect(decidirFrete({ ...base, bairroCliente: 'Outro', taxaPadrao: 7, geocodeIndisponivel: true })).toMatchObject({ entregavel: true, taxa: 7, fonte: 'padrao' })
  })
  it('sem taxa fixa: a maior faixa (nunca de graça por falha do mapa)', () => {
    expect(decidirFrete({ ...base, bairroCliente: 'Outro', taxaPadrao: 0, geocodeIndisponivel: true })).toMatchObject({ entregavel: true, taxa: 8 })
  })
  it('endereço realmente não encontrado (Google respondeu) continua recusando', () => {
    expect(decidirFrete({ ...base, bairroCliente: 'Outro', taxaPadrao: 7 }).entregavel).toBe(false)
  })
})
