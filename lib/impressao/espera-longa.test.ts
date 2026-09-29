import { describe, expect, it } from 'vitest'
import { anunciaEsperaLonga } from './espera-longa'

describe('anunciaEsperaLonga', () => {
  it('impressão automática desligada: não anuncia (o Beta volta ao intervalo normal)', () => {
    expect(anunciaEsperaLonga(20, false)).toBe(false)
    expect(anunciaEsperaLonga(20, null)).toBe(false)
  })
  it('esperou de verdade: anuncia', () => {
    expect(anunciaEsperaLonga(20, true)).toBe(true)
  })
  it('sem pedido de espera: não anuncia', () => {
    expect(anunciaEsperaLonga(0, true)).toBe(false)
  })
})
