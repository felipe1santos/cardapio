import { describe, it, expect } from 'vitest'
import { itemVendavelNaVitrine } from './vitrine-item-vendavel'

const base = { nome: 'X-Burger', preco: 20, promocaoPreco: null, tipoItem: 'simples', tamanhos: [], sabores: [], grupos: [], complementos: [] } as never as Parameters<typeof itemVendavelNaVitrine>[0]

describe('itemVendavelNaVitrine (1.4)', () => {
  it('item normal aparece', () => expect(itemVendavelNaVitrine(base)).toBe(true))
  it('nome que é UUID (upload em lote) não aparece', () => {
    expect(itemVendavelNaVitrine({ ...base, nome: 'B2ab1fe1 Dd8c 4b89 9070 35c9b6531642' })).toBe(false)
    expect(itemVendavelNaVitrine({ ...base, nome: '65205105-a2cc-43c3-bc10-db256ccfa40f' })).toBe(false)
  })
  it('sem nome não aparece', () => expect(itemVendavelNaVitrine({ ...base, nome: '  ' })).toBe(false))
  it('simples a R$ 0 sem nada que forme preço não aparece', () => expect(itemVendavelNaVitrine({ ...base, preco: 0 })).toBe(false))
  it('R$ 0 com tamanho, pizza ou complementos aparece (preço vem das escolhas)', () => {
    expect(itemVendavelNaVitrine({ ...base, preco: 0, tamanhos: [{}] as never })).toBe(true)
    expect(itemVendavelNaVitrine({ ...base, preco: 0, tipoItem: 'pizza' as never })).toBe(true)
    expect(itemVendavelNaVitrine({ ...base, preco: 0, grupos: [{}] as never })).toBe(true)
  })
  it('promoção acima de zero aparece', () => expect(itemVendavelNaVitrine({ ...base, preco: 0, promocaoPreco: 5 })).toBe(true))
})
