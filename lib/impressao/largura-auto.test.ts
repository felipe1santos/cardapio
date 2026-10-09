import { describe, expect, it } from 'vitest'
import { larguraDoDriver } from './largura-auto'

describe('largura do papel pelo driver', () => {
  it('80 mm → 576 pontos; 58 mm → 384', () => {
    expect(larguraDoDriver({ papelLarguraMm: 80 })).toEqual({ larguraMm: 80, larguraPontos: 576 })
    expect(larguraDoDriver({ papelLarguraMm: 79.5 })).toEqual({ larguraMm: 80, larguraPontos: 576 })
    expect(larguraDoDriver({ papelLarguraMm: 58 })).toEqual({ larguraMm: 58, larguraPontos: 384 })
    expect(larguraDoDriver({ papelLarguraMm: 57.9 })).toEqual({ larguraMm: 58, larguraPontos: 384 })
  })
  it('sem papel: usa a área imprimível; sem nada (ou A4 de impressora comum): 80 mm', () => {
    expect(larguraDoDriver({ areaImprimivelLarguraMm: 48 })).toEqual({ larguraMm: 58, larguraPontos: 384 })
    expect(larguraDoDriver({})).toEqual({ larguraMm: 80, larguraPontos: 576 })
    expect(larguraDoDriver(null)).toEqual({ larguraMm: 80, larguraPontos: 576 })
    expect(larguraDoDriver({ papelLarguraMm: 210 })).toEqual({ larguraMm: 80, larguraPontos: 576 })
  })
})
