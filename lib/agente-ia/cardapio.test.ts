import { describe, expect, it } from 'vitest'
import { buscarNoCardapio, sugerirParecidos, type CardapioIa, type ItemIa } from './cardapio'

const item = (nome: string, categoria: string, preco: number, situacao = 'disponivel'): ItemIa =>
  ({ id: nome, nome, descricao: '', categoria, posicao: 0, preco, precoCheio: null, situacao, tipo: 'simples', grupos: [], tamanhos: [], sabores: [] })
const C: CardapioIa = {
  itens: [
    item('Hamburguer Supremo', 'Lanches', 33), item('X-Bacon', 'Lanches', 32), item('X-Salada', 'Lanches', 26), item('Smash Duplo', 'Lanches', 38),
    item('Pizza Calabresa', 'Pizzas', 40), item('Coca-Cola Lata', 'Bebidas', 7), item('X-Egg', 'Lanches', 30, 'pausado'),
  ],
  pizza: { tamanhos: [], bordas: [], massas: [] },
}

describe('item que não existe: sugerir parecidos do cardápio (12/10)', () => {
  it('"x-tudo" não existe → até 3 lanches disponíveis com preço', () => {
    expect(buscarNoCardapio(C, 'x tudo').map((i) => i.nome)).not.toContain('X-Tudo')
    const s = sugerirParecidos(C, 'x tudo')
    expect(s.length).toBeGreaterThan(0)
    expect(s.length).toBeLessThanOrEqual(3)
    expect(s.every((i) => i.categoria === 'Lanches' && i.situacao === 'disponivel')).toBe(true)
  })
  it('bebida pede bebida; nada parecido → os primeiros disponíveis', () => {
    expect(sugerirParecidos(C, 'guarana').map((i) => i.categoria)).toEqual(['Bebidas'])
    expect(sugerirParecidos(C, 'sushi').length).toBeGreaterThan(0)
  })
  it('categoria inteira ("o que vocês têm de pizza") acha pela categoria', () => {
    expect(buscarNoCardapio(C, 'pizza').map((i) => i.nome)).toContain('Pizza Calabresa')
  })
})
