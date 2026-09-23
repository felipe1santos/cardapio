import { describe, it, expect } from 'vitest'
import { avisoDeComandasEsquecidas, comandaEsquecida, COMANDA_ESQUECIDA_MS, tempoAberta } from './comanda-esquecida'

const AGORA = Date.parse('2026-09-22T20:00:00Z')
const hAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString()

describe('comandaEsquecida', () => {
  it('mesa aberta hoje não é esquecida', () => {
    expect(comandaEsquecida({ abertaEm: hAtras(3) }, AGORA)).toBe(false)
    expect(comandaEsquecida({ abertaEm: hAtras(20) }, AGORA)).toBe(false)
  })

  /** Expediente que vira a noite é rotina — o corte é de um dia inteiro. */
  it('o corte é 24 horas', () => {
    expect(comandaEsquecida({ abertaEm: new Date(AGORA - COMANDA_ESQUECIDA_MS).toISOString() }, AGORA)).toBe(true)
    expect(comandaEsquecida({ abertaEm: new Date(AGORA - COMANDA_ESQUECIDA_MS + 1000).toISOString() }, AGORA)).toBe(false)
  })

  /** O caso real: Mesa 06 da MENUZIA, aberta desde 28/06. */
  it('acusa conta de semanas atrás', () => {
    expect(comandaEsquecida({ abertaEm: hAtras(24 * 86) }, AGORA)).toBe(true)
  })

  it('mesa sem conta aberta e data ilegível não viram alarme', () => {
    expect(comandaEsquecida({ abertaEm: null }, AGORA)).toBe(false)
    expect(comandaEsquecida({ abertaEm: 'ontem' }, AGORA)).toBe(false)
  })
})

describe('tempoAberta', () => {
  it('horas no primeiro dia, dias depois', () => {
    expect(tempoAberta(hAtras(5), AGORA)).toBe('5h')
    expect(tempoAberta(hAtras(30), AGORA)).toBe('1 dia')
    expect(tempoAberta(hAtras(24 * 86), AGORA)).toBe('86 dias')
  })
})

describe('avisoDeComandasEsquecidas', () => {
  it('silencia quando está tudo em dia', () => {
    expect(avisoDeComandasEsquecidas([{ abertaEm: hAtras(2) }, { abertaEm: null }], AGORA)).toBeNull()
  })

  it('conta quantas são e diz o que fazer', () => {
    const aviso = avisoDeComandasEsquecidas(
      [{ abertaEm: hAtras(24 * 86) }, { abertaEm: hAtras(24 * 3) }, { abertaEm: hAtras(1) }],
      AGORA,
    )
    expect(aviso).toContain('2 mesas')
    expect(aviso).toMatch(/Feche ou cancele/)
  })

  it('fala no singular com uma só', () => {
    expect(avisoDeComandasEsquecidas([{ abertaEm: hAtras(40) }], AGORA)).toContain('1 mesa está')
  })
})
