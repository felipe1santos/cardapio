import { describe, it, expect } from 'vitest'
import { rotuloOrigemPedido, rotuloDaMesa } from './pedido-origem'

describe('rótulo de origem do pedido', () => {
  it('pedido de mesa diz SALÃO, não PDV — é outro posto de trabalho', () => {
    const r = rotuloOrigemPedido({ canal: 'mesa', origem: 'pdv', mesa: '4', criadoPorNome: 'Ana' })
    expect(r.texto).toBe('Salão · Mesa 4')
    expect(r.responsavel).toBe('Ana')
    expect(r.tom).toBe('salao')
  })

  it('balcão continua sendo PDV', () => {
    const r = rotuloOrigemPedido({ canal: 'balcao', origem: 'pdv', mesa: null, criadoPorNome: 'Caixa 1' })
    expect(r.texto).toBe('PDV · Balcão')
    expect(r.tom).toBe('balcao')
  })

  it('delivery não ganha etiqueta de origem: a tela dele já é sobre entrega', () => {
    const r = rotuloOrigemPedido({ canal: 'delivery', origem: 'cardapio', mesa: null })
    expect(r.texto).toBeNull()
    expect(r.responsavel).toBeNull()
    expect(r.tom).toBe('delivery')
  })

  it('pedido antigo sem canal cai na reserva por origem + mesa', () => {
    expect(rotuloOrigemPedido({ origem: 'pdv', mesa: '7' }).texto).toBe('Salão · Mesa 7')
    expect(rotuloOrigemPedido({ origem: 'pdv', mesa: null }).texto).toBe('PDV · Balcão')
    expect(rotuloOrigemPedido({ origem: 'cardapio' }).texto).toBeNull()
    expect(rotuloOrigemPedido({}).texto).toBeNull()
  })

  it('canal desconhecido não inventa etiqueta de salão', () => {
    expect(rotuloOrigemPedido({ canal: 'marketplace', mesa: '3' }).texto).toBeNull()
  })

  it('nome só numérico ganha o prefixo; nome com texto fica como está', () => {
    expect(rotuloDaMesa('4')).toBe('Mesa 4')
    expect(rotuloDaMesa('07')).toBe('Mesa 07')
    expect(rotuloDaMesa('Varanda 2')).toBe('Varanda 2')
    expect(rotuloDaMesa('  ')).toBe('Mesa')
    expect(rotuloDaMesa(null)).toBe('Mesa')
  })

  it('nome vazio de garçom não vira string vazia na tela', () => {
    expect(rotuloOrigemPedido({ canal: 'mesa', mesa: '1', criadoPorNome: '   ' }).responsavel).toBeNull()
  })
})
