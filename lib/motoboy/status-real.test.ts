import { describe, expect, it } from 'vitest'
import { contarOnline, statusReal, vistoHa } from './status-real'

const AGORA = new Date('2026-10-14T20:00:00Z').getTime()
const base = { online: false, emRota: 0, desativado: false, ultimoAcessoEm: null as string | null }

describe('statusReal (sinal do app do motoboy, não o seletor manual)', () => {
  it('em rota vence o resto e leva os números dos pedidos', () => {
    expect(statusReal({ ...base, online: true, emRota: 2 }, [412, 415], AGORA)).toEqual({ tipo: 'em_rota', texto: 'Em rota · #412, #415' })
  })
  it('em rota sem número conhecido mostra a quantidade', () => {
    expect(statusReal({ ...base, emRota: 1 }, [], AGORA).texto).toBe('Em rota · 1 entrega')
  })
  it('app aberto (sinal < 2 min) é Online', () => {
    expect(statusReal({ ...base, online: true }, [], AGORA)).toEqual({ tipo: 'online', texto: 'Online' })
  })
  it('sem sinal recente é Offline com o último sinal', () => {
    const r = statusReal({ ...base, ultimoAcessoEm: new Date(AGORA - 3 * 3600_000).toISOString() }, [], AGORA)
    expect(r).toEqual({ tipo: 'offline', texto: 'Offline · visto há 3 h' })
  })
  it('nunca abriu o app', () => {
    expect(statusReal(base, [], AGORA).texto).toBe('Offline · nunca abriu o app')
  })
  it('desativado não conta como online nem em rota', () => {
    expect(statusReal({ ...base, desativado: true, online: true }, [], AGORA)).toEqual({ tipo: 'desativado', texto: 'Desativado' })
  })
})

describe('vistoHa', () => {
  it.each([
    [30_000, 'agora'],
    [5 * 60_000, 'há 5 min'],
    [90 * 60_000, 'há 1 h'],
    [26 * 3600_000, 'há 1 dia'],
    [5 * 86400_000, 'há 5 dias'],
  ])('%i ms → %s', (ms, txt) => expect(vistoHa(new Date(AGORA - ms).toISOString(), AGORA)).toBe(txt))
})

describe('contarOnline', () => {
  it('conta app aberto entre os ativos; desativado fica fora do total', () => {
    const lista = [{ ...base, online: true }, { ...base, online: false }, { ...base, online: true, desativado: true }]
    expect(contarOnline(lista)).toEqual({ online: 1, total: 2 })
  })
})
