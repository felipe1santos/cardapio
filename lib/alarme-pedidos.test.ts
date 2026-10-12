import { describe, expect, it } from 'vitest'
import { pedidosParaTocar, reivindicarToque } from './alarme-pedidos'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

describe('pedidosParaTocar', () => {
  it('toca todo recebido que ainda não tocou — inclusive o que já esperava ao abrir o painel', () => {
    expect(pedidosParaTocar(['a', 'b'], new Set())).toEqual(['a', 'b'])
    expect(pedidosParaTocar(['a', 'b', 'c'], new Set(['a', 'b']))).toEqual(['c'])
    expect(pedidosParaTocar([], new Set(['a']))).toEqual([])
  })
})

describe('reivindicarToque', () => {
  it('uma aba toca; a outra fica quieta dentro da janela e volta depois', () => {
    const s = mem()
    expect(reivindicarToque('p1', 'abaA', 1000, s)).toBe(true)
    expect(reivindicarToque('p1', 'abaB', 2000, s)).toBe(false)
    expect(reivindicarToque('p1', 'abaA', 3000, s)).toBe(true)
    expect(reivindicarToque('p1', 'abaB', 20_000, s)).toBe(true)
  })
  it('sem armazenamento, toca', () => {
    expect(reivindicarToque('p1', 'x', 1, null)).toBe(true)
  })
})
