import { describe, expect, it } from 'vitest'
import { podeInstalar } from './atualizacao.js'

const as = (h: number, m = 0) => new Date(2026, 9, 8, h, m)

describe('atualização automática: quando instala', () => {
  it('só fora do pico', () => {
    expect(podeInstalar({ agora: as(4), ultimaAtividadeEm: null, imprimindo: false })).toBe(true)
    expect(podeInstalar({ agora: as(10, 29), ultimaAtividadeEm: null, imprimindo: false })).toBe(true)
    expect(podeInstalar({ agora: as(10, 30), ultimaAtividadeEm: null, imprimindo: false })).toBe(false) // almoço
    expect(podeInstalar({ agora: as(12), ultimaAtividadeEm: null, imprimindo: false })).toBe(false)
    expect(podeInstalar({ agora: as(15), ultimaAtividadeEm: null, imprimindo: false })).toBe(true)
    expect(podeInstalar({ agora: as(19), ultimaAtividadeEm: null, imprimindo: false })).toBe(false) // jantar
    expect(podeInstalar({ agora: as(1), ultimaAtividadeEm: null, imprimindo: false })).toBe(false) // loja ainda aberta
  })

  it('nunca com impressão em andamento ou recente', () => {
    expect(podeInstalar({ agora: as(4), ultimaAtividadeEm: null, imprimindo: true })).toBe(false)
    expect(podeInstalar({ agora: as(4), ultimaAtividadeEm: as(3, 55).getTime(), imprimindo: false })).toBe(false)
    expect(podeInstalar({ agora: as(4), ultimaAtividadeEm: as(3, 49).getTime(), imprimindo: false })).toBe(true)
    expect(podeInstalar({ agora: as(12), ultimaAtividadeEm: null, imprimindo: true, sempre: true })).toBe(false)
  })

  it('modo de teste ignora o horário, mas não a impressão', () => {
    expect(podeInstalar({ agora: as(12), ultimaAtividadeEm: null, imprimindo: false, sempre: true })).toBe(true)
  })
})
