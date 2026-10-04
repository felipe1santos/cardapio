import { describe, expect, it } from 'vitest'
import { marcasX } from './grafico'

describe('rótulos do eixo X', () => {
  const pos = (px: number) => (i: number) => i * px
  it('um a cada passo e sempre o último', () => {
    expect(marcasX(10, 3, pos(30))).toEqual([0, 3, 6, 9])
  })
  it('último perto demais do anterior: sai o anterior (não encostam)', () => {
    // 30 dias, passo 2, 25 px por dia: 28 e 29 ficariam a 25 px.
    const m = marcasX(30, 2, pos(25))
    expect(m[m.length - 1]).toBe(29)
    expect(m).not.toContain(28)
    for (let k = 1; k < m.length; k++) expect((m[k] - m[k - 1]) * 25).toBeGreaterThanOrEqual(50)
  })
  it('poucos pontos e vazio', () => {
    expect(marcasX(1, 1, pos(100))).toEqual([0])
    expect(marcasX(0, 1, pos(100))).toEqual([])
    expect(marcasX(2, 1, pos(300))).toEqual([0, 1])
  })
})
