import { describe, it, expect } from 'vitest'
import { statusVisiveis, podeExecutar, ORIGEM_ESPERADA, MODOS, LABEL_MODO } from './modo'

describe('statusVisiveis', () => {
  it('producao vê recebido e preparando', () => { expect(statusVisiveis('producao')).toEqual(['recebido', 'preparando']) })
  it('expedicao vê só pronto', () => { expect(statusVisiveis('expedicao')).toEqual(['pronto']) })
  it('completa vê recebido, preparando e pronto', () => { expect(statusVisiveis('completa')).toEqual(['recebido', 'preparando', 'pronto']) })
})

describe('podeExecutar', () => {
  it('producao pega/devolve/conclui, não entrega', () => {
    expect(podeExecutar('producao', 'pegar')).toBe(true)
    expect(podeExecutar('producao', 'devolver')).toBe(true)
    expect(podeExecutar('producao', 'concluir')).toBe(true)
    expect(podeExecutar('producao', 'entregue')).toBe(false)
  })
  it('expedicao só entrega', () => {
    expect(podeExecutar('expedicao', 'entregue')).toBe(true)
    expect(podeExecutar('expedicao', 'pegar')).toBe(false)
    expect(podeExecutar('expedicao', 'concluir')).toBe(false)
  })
  it('completa faz tudo', () => {
    for (const a of ['pegar', 'devolver', 'concluir', 'entregue'] as const) expect(podeExecutar('completa', a)).toBe(true)
  })
})

describe('ORIGEM_ESPERADA', () => {
  it('mapeia cada ação ao status de origem', () => {
    expect(ORIGEM_ESPERADA).toEqual({ pegar: 'recebido', devolver: 'preparando', concluir: 'preparando', entregue: 'pronto' })
  })
})

describe('metadados', () => {
  it('lista os 3 modos com rótulos', () => {
    expect(MODOS).toEqual(['producao', 'expedicao', 'completa'])
    expect(LABEL_MODO.producao).toBe('Produção')
  })
})
