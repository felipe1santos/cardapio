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

describe('largura real informada pelo driver (09/10, Villa)', () => {
  it('POS-80 com 574 pontos imprimíveis → 568 (múltiplo de 8, nunca mais larga que a cabeça)', () => {
    expect(larguraDoDriver({ papelLarguraMm: 71.9, pontosImprimiveis: 574 })).toEqual({ larguraMm: 80, larguraPontos: 568 })
  })
  it('576 informados (ou mais) → 576; 58 mm com 370 → 368', () => {
    expect(larguraDoDriver({ papelLarguraMm: 80, pontosImprimiveis: 576 }).larguraPontos).toBe(576)
    expect(larguraDoDriver({ papelLarguraMm: 80, pontosImprimiveis: 640 }).larguraPontos).toBe(576)
    expect(larguraDoDriver({ papelLarguraMm: 58, pontosImprimiveis: 370 })).toEqual({ larguraMm: 58, larguraPontos: 368 })
  })
  it('valor absurdo do driver (muito pequeno) é ignorado', () => {
    expect(larguraDoDriver({ papelLarguraMm: 80, pontosImprimiveis: 100 }).larguraPontos).toBe(576)
  })
})
