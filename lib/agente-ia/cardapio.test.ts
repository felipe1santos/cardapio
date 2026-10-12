import { describe, expect, it } from 'vitest'
import { buscarNoCardapio, familiaDaBusca, sugerirParecidos, type CardapioIa, type ItemIa } from './cardapio'

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

describe('número no nome (teste real 12/10: "Item 1" não achava)', () => {
  it('"Item 1" vem primeiro, à frente de Item 2 e Item 3', () => {
    const n: CardapioIa = { ...C, itens: [item('Item 3', 'Gourmet', 22), item('Item 2', 'Gourmet', 22), item('Item 1', 'Gourmet', 22)] }
    expect(buscarNoCardapio(n, 'Item 1')[0].nome).toBe('Item 1')
    expect(buscarNoCardapio(n, '1 item 1 sem adicional')[0].nome).toBe('Item 1')
  })
})

describe('sinônimos e categoria (teste do Felipe, 11/10, #287)', () => {
  it('"um refri" acha a categoria Bebidas (refri/refrigerante/coca/guaraná/lata/2L)', () => {
    for (const b of ['refri', 'um refri', 'refrigerante', 'guarana', 'uma lata', 'refri 2l']) {
      expect(buscarNoCardapio(C, b).map((i) => i.categoria), b).toContain('Bebidas')
    }
  })
  it('x-burguer / xburger / hamburguer acham o hambúrguer (grafias do cliente)', () => {
    for (const b of ['x-burguer', 'xburger', 'hamburguer', 'hamburger', 'x burguer']) {
      expect(buscarNoCardapio(C, b).map((i) => i.nome), b).toContain('Hamburguer Supremo')
    }
    expect(buscarNoCardapio(C, 'xbacon').map((i) => i.nome)).toContain('X-Bacon')
  })
  it('loja sem bebida: busca vazia e a família é reconhecida (a IA diz que não tem bebida)', () => {
    const sem: CardapioIa = { ...C, itens: C.itens.filter((i) => i.categoria !== 'Bebidas') }
    expect(buscarNoCardapio(sem, 'um refri')).toEqual([])
    expect(familiaDaBusca('um refri')?.rotulo).toBe('bebida')
    expect(familiaDaBusca('sushi')).toBeNull()
  })
})
