import { describe, it, expect } from 'vitest'
import { corDoTempo, filtrar } from './kds'

describe('KDS (5.2)', () => {
  it('cronômetro: normal → atenção → atrasado, com limites configuráveis', () => {
    const lim = { atencaoMin: 10, atrasoMin: 20 }
    expect(corDoTempo(5 * 60000, lim)).toBe('normal')
    expect(corDoTempo(12 * 60000, lim)).toBe('atencao')
    expect(corDoTempo(25 * 60000, lim)).toBe('atraso')
    expect(corDoTempo(6 * 60000, { atencaoMin: 5, atrasoMin: 8 })).toBe('atencao')
  })
  it('filtros: Mesa, Entrega, Retirada', () => {
    const ps = [
      { id: 'm', tipo: 'retirada', canal: 'mesa', mesa: 'Mesa 01' },
      { id: 'e', tipo: 'entrega', canal: 'delivery', mesa: null },
      { id: 'r', tipo: 'retirada', canal: 'delivery', mesa: null },
    ]
    expect(filtrar(ps, 'todos').map((p) => p.id)).toEqual(['m', 'e', 'r'])
    expect(filtrar(ps, 'mesa').map((p) => p.id)).toEqual(['m'])
    expect(filtrar(ps, 'entrega').map((p) => p.id)).toEqual(['e'])
    expect(filtrar(ps, 'retirada').map((p) => p.id)).toEqual(['r'])
  })
})
