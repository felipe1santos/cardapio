import { describe, it, expect } from 'vitest'
import { iniciais } from './iniciais'

describe('iniciais do contato', () => {
  it('primeira letra de até duas palavras', () => {
    expect(iniciais('Dayse Brandão Ferreira', '5527999990000')).toBe('DB')
    expect(iniciais('oziel reis', '5527999990000')).toBe('OR')
  })

  it('emoji e símbolos não quebram o avatar', () => {
    expect(iniciais('L.S 🌟', '5527999990000')).toBe('L')
    expect(iniciais('🌟 Ana', '5527999990000')).toBe('A')
    expect(iniciais('Élen 💐 Souza', '5527999990000')).toBe('ÉS')
  })

  it('sem nome ou sem letra: dois últimos dígitos do telefone', () => {
    expect(iniciais(null, '5511933774346')).toBe('46')
    expect(iniciais('🌟🌟', '5511933774346')).toBe('46')
  })
})
