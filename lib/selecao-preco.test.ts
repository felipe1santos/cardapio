import { describe, it, expect } from 'vitest'
import { precificarLinha, precoAPartirDe, type ItemPrecificavel, type PizzaDaLoja } from './selecao-preco'

const PIZZA_LOJA: PizzaDaLoja = {
  tamanhos: [
    { id: 'm', nome: 'Média', maxSabores: 1 },
    { id: 'g', nome: 'Grande', maxSabores: 2 },
  ],
  bordas: [{ nome: 'Catupiry', preco: 8 }],
  massas: [{ nome: 'Integral', preco: 3 }],
  regra: 'media',
}

const PIZZA_SALGADA: ItemPrecificavel = {
  preco: 69,
  tipoItem: 'pizza',
  tamanhos: [],
  sabores: [
    { nome: 'Calabresa', precos: { m: 50, g: 70 } },
    { nome: 'Portuguesa', precos: { m: 55, g: 80 } },
    { nome: 'Só Grande', precos: { g: 90 } },
  ],
  grupos: [{ nome: 'Adicionais de Pizza', complementos: [{ nome: 'Bacon', preco: 6 }] }],
}

const ACAI: ItemPrecificavel = {
  preco: 10,
  tipoItem: 'simples',
  tamanhos: [
    { nome: '300 ml', preco: 15 },
    { nome: '500 ml', preco: 22 },
  ],
  sabores: [],
  grupos: [{ nome: 'Adicionais', complementos: [{ nome: 'Granola', preco: 2 }] }],
}

describe('preço da linha da seleção da mesa', () => {
  it('pizza: tamanho + sabor define o preço, e o adicional soma', () => {
    const r = precificarLinha(
      PIZZA_SALGADA,
      [
        { grupo: 'Tamanho', escolha: 'Média', preco: 0, tipo: 'tamanho' },
        { grupo: 'Sabor', escolha: 'Calabresa', preco: 0, tipo: 'sabor' },
        { grupo: 'Adicionais de Pizza', escolha: 'Bacon', preco: 999, tipo: 'opcao' },
      ],
      PIZZA_LOJA,
    )
    expect(r.completa).toBe(true)
    expect(r.precoUnitario).toBe(50)
    expect(r.opcoes.find((o) => o.escolha === 'Bacon')!.preco).toBe(6) // preço do catálogo, não do navegador
  })

  it('pizza meio a meio: média dos sabores no tamanho, borda e massa somam', () => {
    const r = precificarLinha(
      PIZZA_SALGADA,
      [
        { grupo: 'Tamanho', escolha: 'Grande', preco: 0, tipo: 'tamanho' },
        { grupo: 'Sabor', escolha: 'Calabresa', preco: 0, tipo: 'sabor' },
        { grupo: 'Sabor', escolha: 'Portuguesa', preco: 0, tipo: 'sabor' },
        { grupo: 'Borda', escolha: 'Catupiry', preco: 0, tipo: 'borda' },
        { grupo: 'Massa', escolha: 'Integral', preco: 0, tipo: 'massa' },
      ],
      PIZZA_LOJA,
    )
    expect(r.precoUnitario).toBe(75)
    expect(r.opcoes.reduce((s, o) => s + o.preco, 0)).toBe(11)
  })

  it('pizza: sabor além do limite do tamanho ou sem preço nele é descartado', () => {
    const r = precificarLinha(
      PIZZA_SALGADA,
      [
        { grupo: 'Tamanho', escolha: 'Média', preco: 0, tipo: 'tamanho' },
        { grupo: 'Sabor', escolha: 'Só Grande', preco: 0, tipo: 'sabor' },
        { grupo: 'Sabor', escolha: 'Calabresa', preco: 0, tipo: 'sabor' },
        { grupo: 'Sabor', escolha: 'Portuguesa', preco: 0, tipo: 'sabor' },
      ],
      PIZZA_LOJA,
    )
    expect(r.opcoes.filter((o) => o.tipo === 'sabor').map((o) => o.escolha)).toEqual(['Calabresa'])
    expect(r.precoUnitario).toBe(50)
  })

  it('pizza sem sabor fica incompleta', () => {
    const r = precificarLinha(PIZZA_SALGADA, [{ grupo: 'Tamanho', escolha: 'Grande', preco: 0, tipo: 'tamanho' }], PIZZA_LOJA)
    expect(r.completa).toBe(false)
  })

  it('item com tamanhos: o tamanho SUBSTITUI o preço-base (antes somava)', () => {
    const r = precificarLinha(ACAI, [{ grupo: 'Escolha o tamanho', escolha: '500 ml', preco: 22 }], PIZZA_LOJA)
    expect(r.precoUnitario).toBe(22)
    expect(r.opcoes).toEqual([{ grupo: 'Tamanho', escolha: '500 ml', preco: 0, tipo: 'tamanho' }])
  })

  it('"a partir de": menor preço de sabor na pizza, menor tamanho no item com tamanhos', () => {
    expect(precoAPartirDe(PIZZA_SALGADA, PIZZA_LOJA)).toBe(50)
    expect(precoAPartirDe(ACAI, PIZZA_LOJA)).toBe(15)
  })
})
