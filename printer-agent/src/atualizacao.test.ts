import { describe, expect, it } from 'vitest'
import { podeInstalar } from './atualizacao.js'

const as = (h: number, m = 0, s = 0) => new Date(2026, 9, 8, h, m, s)

describe('atualização automática (1.1.0): instala com a fila de impressão vazia', () => {
  it('a qualquer hora, com a fila vazia', () => {
    for (const h of [1, 4, 12, 19, 23]) expect(podeInstalar({ agora: as(h), ultimaAtividadeEm: null, imprimindo: false })).toBe(true)
  })
  it('nunca com algo imprimindo ou esperando na fila', () => {
    expect(podeInstalar({ agora: as(12), ultimaAtividadeEm: null, imprimindo: true })).toBe(false)
    expect(podeInstalar({ agora: as(12), ultimaAtividadeEm: null, imprimindo: false, pendentes: 1 })).toBe(false)
  })
  it('espera 1 minuto depois da última impressão (rajada de pedidos)', () => {
    expect(podeInstalar({ agora: as(12, 0, 30), ultimaAtividadeEm: as(12).getTime(), imprimindo: false })).toBe(false)
    expect(podeInstalar({ agora: as(12, 1, 1), ultimaAtividadeEm: as(12).getTime(), imprimindo: false })).toBe(true)
  })
})
