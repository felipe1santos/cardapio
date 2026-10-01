import { describe, expect, it } from 'vitest'
import { contraste, contrasteBaixo, normalizarHex, hexValido } from './aviso-vitrine'

describe('aviso da vitrine', () => {
  it('normaliza hex', () => {
    expect(normalizarHex('abc')).toBe('#AABBCC')
    expect(normalizarHex('#0369a1')).toBe('#0369A1')
    expect(normalizarHex('xyz')).toBeNull()
    expect(hexValido('#0369A1')).toBe(true)
    expect(hexValido('red')).toBe(false)
  })
  it('contraste WCAG', () => {
    expect(contraste('#000000', '#FFFFFF')).toBe(21)
    expect(contraste('#FFFFFF', '#FFFFFF')).toBe(1)
  })
  it('alerta de contraste baixo', () => {
    expect(contrasteBaixo({ corTexto: '#FFFFFF', corFundo: '#FEF3C7', pulsar: false })).toBe(true)
    expect(contrasteBaixo({ corTexto: '#0369A1', corFundo: '#E0F2FE', pulsar: false })).toBe(false)
    expect(contrasteBaixo({ corTexto: null, corFundo: null, pulsar: false })).toBe(false)
  })
})
