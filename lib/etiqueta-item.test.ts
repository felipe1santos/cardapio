import { describe, it, expect } from 'vitest'
import { ETIQUETAS_ITEM, SELO_MAIS_PEDIDOS, etiquetaDoItem, mostraSeloMaisPedidos, tagDoItem } from './etiqueta-item'
import { TAGS_ITEM } from './queries/cardapio'

describe('tagDoItem', () => {
  it('sem tag, sem promoção e sem destaque não mostra etiqueta', () => {
    expect(tagDoItem({ tag: null, promocaoPreco: null })).toBeNull()
  })

  it('a tag do cadastro manda', () => {
    expect(tagDoItem({ tag: 'novo', promocaoPreco: 10, maisVendido: true })).toBe('novo')
  })

  /** Desconto ativo tem que aparecer mesmo sem o lojista marcar nada. */
  it('promoção vira etiqueta sozinha', () => {
    expect(tagDoItem({ tag: null, promocaoPreco: 19.9 })).toBe('promocao')
  })

  it('"Mais Pedidos" não vira etiqueta: tem selo próprio (inclusive a tag antiga)', () => {
    expect(tagDoItem({ tag: null, promocaoPreco: null, maisVendido: true })).toBeNull()
    expect(tagDoItem({ tag: null, promocaoPreco: 5, maisVendido: true })).toBe('promocao')
    expect(tagDoItem({ tag: 'mais_pedido', promocaoPreco: null })).toBeNull()
    expect(tagDoItem({ tag: 'favorito', promocaoPreco: 5 })).toBe('promocao')
  })
})

describe('mostraSeloMaisPedidos', () => {
  it('aparece só para a etiqueta "Mais Pedidos" (26/10/2026: a estrela/Destaque não dá mais o selo)', () => {
    expect(mostraSeloMaisPedidos({ tag: 'mais_pedido' })).toBe(true)
    expect(mostraSeloMaisPedidos({ maisVendido: true, tag: 'mais_pedido' })).toBe(true)
    expect(mostraSeloMaisPedidos({ maisVendido: true, tag: null })).toBe(false)
    expect(mostraSeloMaisPedidos({ tag: 'favorito' })).toBe(false)
    expect(SELO_MAIS_PEDIDOS).toMatchObject({ label: 'Mais Pedidos', fundo: '#E80002', texto: '#FFFFFF' })
  })
  it('não aparece sem marcação', () => {
    expect(mostraSeloMaisPedidos({ maisVendido: false, tag: null })).toBe(false)
    expect(mostraSeloMaisPedidos({ tag: null })).toBe(false)
  })
})

describe('etiquetaDoItem', () => {
  it('devolve rótulo e cores prontos', () => {
    const e = etiquetaDoItem({ tag: null, promocaoPreco: 12 })
    expect(e).toMatchObject({ label: '🏷️ Promoção', fundo: '#DCFCE7', texto: '#15803D' })
  })

  it('tag desconhecida (cadastro antigo) não quebra a lista', () => {
    expect(etiquetaDoItem({ tag: 'tag_que_nao_existe', promocaoPreco: null })).toBeNull()
  })

  /** Se alguém cadastrar uma tag nova no admin, ela precisa ter estilo aqui. */
  it('toda tag oferecida no cadastro tem estilo', () => {
    for (const { id } of TAGS_ITEM) {
      expect(ETIQUETAS_ITEM[id], `falta estilo para a tag ${id}`).toBeTruthy()
    }
  })
})
