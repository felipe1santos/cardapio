import { describe, it, expect } from 'vitest'
import { totalDaLinha, totalDaSelecao, quantidadeDaSelecao, sanearSelecao } from './mesa-sessao'

const CATALOGO = new Map([
  ['i1', { nome: 'Filé à Parmegiana', preco: 68 }],
  ['i2', { nome: 'Água com Gás', preco: 7 }],
])

describe('totais da seleção', () => {
  it('soma adicionais antes de multiplicar pela quantidade', () => {
    const linha = {
      precoUnitario: 68,
      quantidade: 2,
      opcoes: [
        { grupo: 'Adicionais', escolha: 'Bacon', preco: 6 },
        { grupo: 'Ponto', escolha: 'Ao ponto', preco: 0 },
      ],
    }
    expect(totalDaLinha(linha)).toBe(148)
  })

  it('ignora preço inválido de opção', () => {
    const linha = {
      precoUnitario: 10,
      quantidade: 1,
      opcoes: [{ grupo: 'x', escolha: 'y', preco: Number.NaN }],
    }
    expect(totalDaLinha(linha)).toBe(10)
  })

  it('soma a lista inteira e conta as unidades', () => {
    const itens = [
      { itemId: 'i1', nome: 'A', precoUnitario: 10, quantidade: 2, observacao: '', opcoes: [] },
      { itemId: 'i2', nome: 'B', precoUnitario: 7, quantidade: 3, observacao: '', opcoes: [] },
    ]
    expect(totalDaSelecao(itens)).toBe(41)
    expect(quantidadeDaSelecao(itens)).toBe(5)
  })
})

describe('sanearSelecao', () => {
  it('relê nome e preço do catálogo, ignorando o que o navegador mandou', () => {
    const itens = sanearSelecao(
      [{ itemId: 'i1', nome: 'Filé de graça', precoUnitario: 0, quantidade: 1, opcoes: [] }],
      CATALOGO,
    )
    expect(itens).toHaveLength(1)
    expect(itens[0].nome).toBe('Filé à Parmegiana')
    expect(itens[0].precoUnitario).toBe(68)
  })

  it('descarta item que não é do catálogo da loja', () => {
    expect(sanearSelecao([{ itemId: 'de-outra-loja', quantidade: 1 }], CATALOGO)).toEqual([])
  })

  it('descarta linha sem itemId', () => {
    expect(sanearSelecao([{ nome: 'solto', quantidade: 1 }], CATALOGO)).toEqual([])
  })

  it('limita quantidade a 1..99', () => {
    expect(sanearSelecao([{ itemId: 'i2', quantidade: 0 }], CATALOGO)[0].quantidade).toBe(1)
    expect(sanearSelecao([{ itemId: 'i2', quantidade: -5 }], CATALOGO)[0].quantidade).toBe(1)
    expect(sanearSelecao([{ itemId: 'i2', quantidade: 5000 }], CATALOGO)[0].quantidade).toBe(99)
    expect(sanearSelecao([{ itemId: 'i2', quantidade: 2.9 }], CATALOGO)[0].quantidade).toBe(2)
  })

  it('corta observação longa e recusa observação que não é texto', () => {
    const longa = sanearSelecao([{ itemId: 'i2', quantidade: 1, observacao: 'x'.repeat(500) }], CATALOGO)
    expect(longa[0].observacao).toHaveLength(280)
    const objeto = sanearSelecao([{ itemId: 'i2', quantidade: 1, observacao: { a: 1 } }], CATALOGO)
    expect(objeto[0].observacao).toBe('')
  })

  it('normaliza opções e recusa preço negativo', () => {
    const itens = sanearSelecao(
      [{ itemId: 'i1', quantidade: 1, opcoes: [{ grupo: 'Adicionais', escolha: 'Bacon', preco: -50 }] }],
      CATALOGO,
    )
    expect(itens[0].opcoes[0].preco).toBe(0)
  })

  it('descarta opção sem escolha', () => {
    const itens = sanearSelecao(
      [{ itemId: 'i1', quantidade: 1, opcoes: [{ grupo: 'g', escolha: '', preco: 1 }] }],
      CATALOGO,
    )
    expect(itens[0].opcoes).toEqual([])
  })

  it('aguenta lixo sem explodir', () => {
    for (const lixo of [null, undefined, 'texto', 42, {}, [null], [1, 2, 3]]) {
      expect(() => sanearSelecao(lixo, CATALOGO)).not.toThrow()
    }
    expect(sanearSelecao(null, CATALOGO)).toEqual([])
  })

  it('limita o tamanho da lista', () => {
    const muitos = Array.from({ length: 200 }, () => ({ itemId: 'i2', quantidade: 1 }))
    expect(sanearSelecao(muitos, CATALOGO)).toHaveLength(60)
  })
})
