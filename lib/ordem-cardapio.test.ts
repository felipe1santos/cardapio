import { describe, expect, it } from 'vitest'
import { cardapioOrdenado, compararOrdem, listaDeOrdemValida, moverNaLista, ordenar, ordenarCategorias } from './ordem-cardapio'

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

describe('compararOrdem', () => {
  it('posição, depois criação, depois id', () => {
    const lista = [
      { id: 'c', posicao: 1, criadoEm: '2026-01-02' },
      { id: 'b', posicao: 1, criadoEm: '2026-01-01' },
      { id: 'a', posicao: 0, criadoEm: '2026-01-03' },
      { id: 'd', posicao: 1, criadoEm: '2026-01-01' },
    ]
    expect(ordenar(lista).map((x) => x.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('sem posição vai depois das posicionadas', () => {
    expect(ordenar([{ id: 'x', posicao: null }, { id: 'y', posicao: 5 }]).map((x) => x.id)).toEqual(['y', 'x'])
    expect(compararOrdem({ id: 'a' }, { id: 'a' })).toBe(0)
  })

  it('não altera a lista original', () => {
    const lista = [{ id: 'b', posicao: 1 }, { id: 'a', posicao: 0 }]
    ordenar(lista)
    expect(lista[0].id).toBe('b')
  })
})

describe('ordenarCategorias', () => {
  const grupos = [
    { id: 'pizza', posicao: 0 },
    { id: 'lanche', posicao: 1 },
    { id: 'bebida', posicao: 2 },
  ]

  it('sem ordem da mesa, segue o Gestor', () => {
    expect(ordenarCategorias(grupos).map((g) => g.id)).toEqual(['pizza', 'lanche', 'bebida'])
    expect(ordenarCategorias(grupos, new Map([['pizza', null]])).map((g) => g.id)).toEqual(['pizza', 'lanche', 'bebida'])
  })

  it('ordem própria da mesa (0074) continua valendo; as sem posição vêm depois, na ordem do Gestor', () => {
    const mesa = new Map<string, number | null>([['bebida', 1]])
    expect(ordenarCategorias(grupos, mesa).map((g) => g.id)).toEqual(['bebida', 'pizza', 'lanche'])
  })
})

describe('cardapioOrdenado', () => {
  const grupos = [
    { id: 'g2', posicao: 1, nome: 'Bebidas' },
    { id: 'g1', posicao: 0, nome: 'Lanches' },
    { id: 'g3', posicao: 2, nome: 'Vazia' },
  ]
  const itens = [
    { id: 'coca15', grupoId: 'g2', posicao: 1, visivel: true, favorito: true },
    { id: 'lata', grupoId: 'g2', posicao: 0, visivel: true, favorito: false },
    { id: 'xburger', grupoId: 'g1', posicao: 0, visivel: true, favorito: false },
    { id: 'pausado', grupoId: 'g1', posicao: 1, visivel: false, favorito: false },
    { id: 'orfao', grupoId: null, posicao: 0, visivel: true, favorito: false },
  ]

  it('categorias e itens na ordem configurada; categoria sem item visível sai', () => {
    const r = cardapioOrdenado(grupos, itens, { itemVisivel: (i) => i.visivel })
    expect(r.map((c) => c.grupo.id)).toEqual(['g1', 'g2'])
    expect(r.map((c) => c.itens.map((i) => i.id))).toEqual([['xburger'], ['lata', 'coca15']])
  })

  it('favorito não muda a ordem', () => {
    const r = cardapioOrdenado(grupos, itens)
    expect(r[1].itens.map((i) => i.id)).toEqual(['lata', 'coca15'])
  })

  it('item pausado mantém a posição: ao voltar, volta no mesmo lugar', () => {
    const antes = cardapioOrdenado(grupos, itens, { itemVisivel: (i) => i.visivel })
    expect(antes[0].itens.map((i) => i.id)).toEqual(['xburger'])
    const depois = cardapioOrdenado(grupos, itens.map((i) => ({ ...i, visivel: true })))
    expect(depois[0].itens.map((i) => i.id)).toEqual(['xburger', 'pausado'])
  })

  it('filtro de categoria (horário) é do chamador', () => {
    const r = cardapioOrdenado(grupos, itens, { grupoVisivel: (g) => g.id !== 'g1' })
    expect(r.map((c) => c.grupo.id)).toEqual(['g2'])
  })
})

describe('moverNaLista', () => {
  it('move para cima, para baixo e respeita os limites', () => {
    expect(moverNaLista(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(moverNaLista(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(moverNaLista(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a'])
    expect(moverNaLista(['a', 'b', 'c'], 'b', -5)).toEqual(['b', 'a', 'c'])
    expect(moverNaLista(['a', 'b'], 'z', 0)).toEqual(['a', 'b'])
  })
})

describe('listaDeOrdemValida', () => {
  it('aceita ids únicos', () => {
    expect(listaDeOrdemValida([id(1), id(2)], 10)).toEqual({ ok: true, ids: [id(1), id(2)] })
  })
  it('recusa vazio, repetido, formato estranho e acima do limite', () => {
    expect(listaDeOrdemValida([], 10).ok).toBe(false)
    expect(listaDeOrdemValida('x', 10).ok).toBe(false)
    expect(listaDeOrdemValida([id(1), id(1)], 10)).toEqual({ ok: false, erro: 'Item repetido na ordem.' })
    expect(listaDeOrdemValida(["1' or 1=1"], 10).ok).toBe(false)
    expect(listaDeOrdemValida([1, 2], 10).ok).toBe(false)
    expect(listaDeOrdemValida([id(1), id(2), id(3)], 2).ok).toBe(false)
  })
})
