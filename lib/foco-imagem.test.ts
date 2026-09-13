import { describe, it, expect } from 'vitest'
import { FOCO_PADRAO, focoValido, objectPosition, type Foco } from './foco-imagem'

describe('focoValido', () => {
  it('passa números dentro da faixa', () => {
    expect(focoValido(10, 90)).toEqual({ x: 10, y: 90 })
  })

  it('aceita string numérica — é o que o Postgres devolve pra numeric', () => {
    expect(focoValido('25.5', '75')).toEqual({ x: 25.5, y: 75 })
  })

  it('satura fora da faixa em vez de quebrar o layout', () => {
    expect(focoValido(-40, 180)).toEqual({ x: 0, y: 100 })
  })

  it('cai no centro pro que não é número', () => {
    expect(focoValido(null, undefined)).toEqual(FOCO_PADRAO)
    expect(focoValido('abc', {})).toEqual(FOCO_PADRAO)
    expect(focoValido(NaN, Infinity)).toEqual(FOCO_PADRAO)
  })

  it('cai no centro pra string vazia ou só espaço — Number("") é 0, não NaN', () => {
    expect(focoValido('', '')).toEqual(FOCO_PADRAO)
    expect(focoValido('   ', '   ')).toEqual(FOCO_PADRAO)
    expect(focoValido('', 50)).toEqual(FOCO_PADRAO)
    expect(focoValido(50, '   ')).toEqual(FOCO_PADRAO)
  })

  it('descarta o eixo bom quando o outro é inválido, em vez de ancorar num ponto parcial', () => {
    expect(focoValido(30, 'abc')).toEqual(FOCO_PADRAO)
    expect(focoValido('abc', 30)).toEqual(FOCO_PADRAO)
  })

  it('o padrão é o centro — o mesmo que object-cover sem object-position', () => {
    expect(FOCO_PADRAO).toEqual({ x: 50, y: 50 })
  })
})

describe('objectPosition', () => {
  it('formata como a CSS espera', () => {
    expect(objectPosition({ x: 50, y: 50 })).toBe('50% 50%')
    expect(objectPosition({ x: 0, y: 100 })).toBe('0% 100%')
  })

  it('não deixa sobra de ponto flutuante virar string feia', () => {
    const f: Foco = { x: 33.333333, y: 66.666666 }
    expect(objectPosition(f)).toBe('33.33% 66.67%')
  })
})
