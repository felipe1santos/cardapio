import { describe, it, expect } from 'vitest'
import { ETIQUETAS_ITEM, SELO_FAVORITO, etiquetaDoItem, mostraSeloFavorito, tagDoItem } from './etiqueta-item'
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

  it('favorito não vira etiqueta: tem selo próprio', () => {
    expect(tagDoItem({ tag: null, promocaoPreco: null, maisVendido: true })).toBeNull()
    expect(tagDoItem({ tag: null, promocaoPreco: 5, maisVendido: true })).toBe('promocao')
  })
})

describe('mostraSeloFavorito', () => {
  it('aparece para o favorito, junto com promoção ou outra etiqueta', () => {
    expect(mostraSeloFavorito({ maisVendido: true, tag: null })).toBe(true)
    expect(mostraSeloFavorito({ maisVendido: true, tag: 'novo' })).toBe(true)
    expect(SELO_FAVORITO.label).toBe('★ Favorito')
  })
  it('não aparece sem favorito nem repete "Favorito da casa"', () => {
    expect(mostraSeloFavorito({ maisVendido: false, tag: null })).toBe(false)
    expect(mostraSeloFavorito({ tag: null })).toBe(false)
    expect(mostraSeloFavorito({ maisVendido: true, tag: 'favorito' })).toBe(false)
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
