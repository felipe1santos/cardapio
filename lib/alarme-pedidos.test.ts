import { describe, expect, it } from 'vitest'
import { deveRepetir, pedidosParaTocar, reivindicarToque } from './alarme-pedidos'

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

describe('pedidosParaTocar', () => {
  it('toca todo recebido que ainda não tocou — inclusive o que já esperava ao abrir o painel', () => {
    expect(pedidosParaTocar(['a', 'b'], new Set())).toEqual(['a', 'b'])
    expect(pedidosParaTocar(['a', 'b', 'c'], new Set(['a', 'b']))).toEqual(['c'])
    expect(pedidosParaTocar([], new Set(['a']))).toEqual([])
  })
})

describe('deveRepetir', () => {
  const base = { repetirSeg: 15, pendentes: 1, somLigado: true, ultimoToque: 0, agora: 15_000 }
  it('repete enquanto houver pendente, sem limite de 2 minutos', () => {
    expect(deveRepetir(base)).toBe(true)
    expect(deveRepetir({ ...base, agora: 10 * 60_000, ultimoToque: 10 * 60_000 - 15_000 })).toBe(true)
  })
  it('não repete sem pendente, com som desligado, antes do intervalo ou com repetição desligada', () => {
    expect(deveRepetir({ ...base, pendentes: 0 })).toBe(false)
    expect(deveRepetir({ ...base, somLigado: false })).toBe(false)
    expect(deveRepetir({ ...base, agora: 10_000 })).toBe(false)
    expect(deveRepetir({ ...base, repetirSeg: 0 })).toBe(false)
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
