import { describe, it, expect } from 'vitest'
import { criarLimitador, ipDaRequisicao } from './limite-taxa'

describe('criarLimitador (B16)', () => {
  it('bloqueia ao atingir o máximo e libera quando a janela passa', () => {
    const l = criarLimitador({ max: 3, janelaMs: 1000 })
    for (let i = 0; i < 3; i++) { expect(l.excedeu('a', i)).toBe(false); l.registrar('a', i) }
    expect(l.excedeu('a', 10)).toBe(true)
    expect(l.excedeu('b', 10)).toBe(false)
    expect(l.excedeu('a', 1002)).toBe(false)
  })
  it('limpar zera a chave', () => {
    const l = criarLimitador({ max: 1, janelaMs: 1000 })
    l.registrar('a', 0)
    expect(l.excedeu('a', 1)).toBe(true)
    l.limpar('a')
    expect(l.excedeu('a', 1)).toBe(false)
  })
  it('não guarda chaves sem fim', () => {
    const l = criarLimitador({ max: 1, janelaMs: 60_000, maxChaves: 2 })
    l.registrar('x', 0); l.registrar('y', 0); l.registrar('z', 0)
    expect(l.excedeu('x', 1)).toBe(false)
    expect(l.excedeu('z', 1)).toBe(true)
  })
  it('IP pelo primeiro do x-forwarded-for', () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null })
    expect(ipDaRequisicao(h({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }))).toBe('200.1.2.3')
    expect(ipDaRequisicao(h({ 'x-real-ip': '1.1.1.1' }))).toBe('1.1.1.1')
    expect(ipDaRequisicao(h({}))).toBe('desconhecido')
  })
})
