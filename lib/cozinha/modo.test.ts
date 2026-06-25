import { describe, it, expect } from 'vitest'
import { statusVisiveis, podeExecutar, transicaoDe, MODOS, LABEL_MODO } from './modo'

describe('statusVisiveis', () => {
  it('produção vê recebido e preparando', () => {
    expect(statusVisiveis('producao')).toEqual(['recebido', 'preparando'])
  })
  it('expedição vê só pronto', () => {
    expect(statusVisiveis('expedicao')).toEqual(['pronto'])
  })
  it('completa vê recebido, preparando e pronto', () => {
    expect(statusVisiveis('completa')).toEqual(['recebido', 'preparando', 'pronto'])
  })
})

describe('podeExecutar', () => {
  it('produção aceita e marca pronto, mas não entrega', () => {
    expect(podeExecutar('producao', 'aceitar')).toBe(true)
    expect(podeExecutar('producao', 'pronto')).toBe(true)
    expect(podeExecutar('producao', 'entregue')).toBe(false)
  })
  it('expedição só entrega', () => {
    expect(podeExecutar('expedicao', 'entregue')).toBe(true)
    expect(podeExecutar('expedicao', 'aceitar')).toBe(false)
    expect(podeExecutar('expedicao', 'pronto')).toBe(false)
  })
  it('completa faz tudo', () => {
    for (const a of ['aceitar', 'pronto', 'entregue'] as const) {
      expect(podeExecutar('completa', a)).toBe(true)
    }
  })
})

describe('transicaoDe', () => {
  it('aceitar → preparando via avançar', () => {
    expect(transicaoDe('aceitar')).toEqual({ status: 'preparando', viaEntregue: false })
  })
  it('pronto → pronto via avançar', () => {
    expect(transicaoDe('pronto')).toEqual({ status: 'pronto', viaEntregue: false })
  })
  it('entregue → entregue via marcarPedidoEntregue', () => {
    expect(transicaoDe('entregue')).toEqual({ status: 'entregue', viaEntregue: true })
  })
})

describe('metadados', () => {
  it('lista os 3 modos com rótulos', () => {
    expect(MODOS).toEqual(['producao', 'expedicao', 'completa'])
    expect(LABEL_MODO.producao).toBe('Produção')
  })
})
