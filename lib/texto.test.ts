import { describe, it, expect } from 'vitest'
import { capitalizarTexto } from './texto'

describe('capitalizarTexto', () => {
  it('sobe a primeira letra de cada palavra', () => {
    expect(capitalizarTexto('rua olibira moreira rodrigues')).toBe('Rua Olibira Moreira Rodrigues')
  })

  it('desce o texto todo em maiúsculas', () => {
    expect(capitalizarTexto('RUA DAS FLORES, 10 - CENTRO')).toBe('Rua das Flores, 10 - Centro')
  })

  it('mantém conectores minúsculos no meio, mas sobe no começo', () => {
    expect(capitalizarTexto('avenida do contorno')).toBe('Avenida do Contorno')
    expect(capitalizarTexto('da praia grande')).toBe('Da Praia Grande')
  })

  it('preserva números, pontuação e acentos', () => {
    expect(capitalizarTexto('praça joão pessoa, 45 (fundos)')).toBe('Praça João Pessoa, 45 (Fundos)')
  })

  it('lida com vazio, nulo e indefinido', () => {
    expect(capitalizarTexto('')).toBe('')
    expect(capitalizarTexto(null)).toBe('')
    expect(capitalizarTexto(undefined)).toBe('')
  })

  it('não quebra texto já formatado', () => {
    expect(capitalizarTexto('Jaburuna, Vila Velha')).toBe('Jaburuna, Vila Velha')
  })

  it('preserva siglas curtas em caixa alta', () => {
    expect(capitalizarTexto('rua x, 10 - santos dumont - MG')).toBe('Rua X, 10 - Santos Dumont - MG')
    expect(capitalizarTexto('AVENIDA ES 010, KM 3')).toBe('Avenida ES 010, KM 3')
  })
})
