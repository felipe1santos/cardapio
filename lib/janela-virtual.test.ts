import { describe, expect, it } from 'vitest'
import { janelaVisivel } from './janela-virtual'

describe('janelaVisivel', () => {
  it('topo: do zero até a altura + folga', () => {
    expect(janelaVisivel(1000, 0, 370, 37, 8)).toEqual({ inicio: 0, fim: 18 })
  })
  it('meio da lista', () => {
    expect(janelaVisivel(1000, 3700, 370, 37, 8)).toEqual({ inicio: 92, fim: 118 })
  })
  it('fim nunca passa do total', () => {
    expect(janelaVisivel(20, 5000, 370, 37, 8).fim).toBe(20)
  })
})
