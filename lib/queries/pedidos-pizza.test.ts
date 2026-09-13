import { describe, it, expect } from 'vitest'
import { resolverPizza, type SaborCatalogo } from './pedidos-pizza'

const TAM_GRANDE = { id: 'tam-g', nome: 'Grande', maxSabores: 3 }
const TAM_PEQUENA = { id: 'tam-p', nome: 'Pequena', maxSabores: 1 }

function sabor(nome: string, preco: number, status = 'disponivel'): SaborCatalogo {
  return { nome, status, precoPorTamanho: new Map([['tam-g', preco], ['tam-p', preco - 20]]) }
}

const catalogo = [sabor('Calabresa', 89), sabor('Portuguesa', 99), sabor('Marguerita', 109), sabor('Atum', 89, 'pausado')]

describe('resolverPizza', () => {
  it('um sabor: preço do sabor no tamanho', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa', catalogo, regra: 'media' })
    expect(r).toEqual({ base: 89, saborNome: 'Calabresa' })
  })

  it('dois sabores com regra media', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Portuguesa', catalogo, regra: 'media' })
    expect(r).toEqual({ base: 94, saborNome: 'Calabresa / Portuguesa' })
  })

  it('dois sabores com regra maior', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Portuguesa', catalogo, regra: 'maior' })
    expect(r.base).toBe(99)
  })

  it('recusa mais sabores do que o tamanho permite', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_PEQUENA, saborTexto: 'Calabresa / Portuguesa', catalogo, regra: 'media' }),
    ).toThrow(/Pequena.*1 sabor/i)
  })

  it('recusa sabor que não existe', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Frango', catalogo, regra: 'media' }),
    ).toThrow(/"Frango"/)
  })

  it('recusa sabor pausado', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Atum', catalogo, regra: 'media' }),
    ).toThrow(/"Atum"/)
  })

  it('recusa sabor repetido', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Calabresa / Calabresa', catalogo, regra: 'media' }),
    ).toThrow(/repetido/i)
  })

  it('recusa sabor sem preço nesse tamanho', () => {
    const soBrotinho: SaborCatalogo[] = [{ nome: 'Brot 2 Amores', status: 'disponivel', precoPorTamanho: new Map([['tam-brot', 49]]) }]
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Brotinho', tamanho: TAM_GRANDE, saborTexto: 'Brot 2 Amores', catalogo: soBrotinho, regra: 'media' }),
    ).toThrow(/não é vendido no tamanho "Grande"/i)
  })

  it('recusa texto de sabor vazio', () => {
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: '', catalogo, regra: 'media' }),
    ).toThrow(/Selecione.*sabor/i)
  })

  it('devolve o nome normalizado do catálogo, não o que o cliente mandou', () => {
    const r = resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'calabresa / PORTUGUESA', catalogo, regra: 'media' })
    expect(r.saborNome).toBe('Calabresa / Portuguesa')
  })
})

/**
 * Loja que já existia antes do meio a meio pode ter sabor cadastrado com " / "
 * no próprio nome ("Frango / Catupiry"). A guarda de cadastro só impede nome
 * NOVO; o que já está no banco tem que continuar vendendo.
 */
describe('resolverPizza — sabor legado com " / " no nome', () => {
  const legado = sabor('Frango / Catupiry', 99)

  it('casa o texto inteiro contra o catálogo e trata como um sabor só', () => {
    const r = resolverPizza({
      itemNome: 'Pizza Salgada',
      tamanho: TAM_GRANDE,
      saborTexto: 'Frango / Catupiry',
      catalogo: [...catalogo, legado],
      regra: 'media',
    })
    expect(r).toEqual({ base: 99, saborNome: 'Frango / Catupiry' })
  })

  it('vale também em tamanho de 1 sabor, sem estourar o limite', () => {
    const r = resolverPizza({
      itemNome: 'Pizza Salgada',
      tamanho: TAM_PEQUENA,
      saborTexto: 'frango / catupiry',
      catalogo: [...catalogo, legado],
      regra: 'media',
    })
    expect(r).toEqual({ base: 79, saborNome: 'Frango / Catupiry' })
  })

  it('não atrapalha uma escolha de dois sabores de verdade', () => {
    const r = resolverPizza({
      itemNome: 'Pizza Salgada',
      tamanho: TAM_GRANDE,
      saborTexto: 'Calabresa / Portuguesa',
      catalogo: [...catalogo, legado],
      regra: 'media',
    })
    expect(r).toEqual({ base: 94, saborNome: 'Calabresa / Portuguesa' })
  })

  it('o sabor inteiro tem precedência sobre as partes quando as duas existem', () => {
    // Catálogo com "A / B" legado E "A" e "B" separados: o texto inteiro ganha.
    const comAmbos: SaborCatalogo[] = [sabor('Frango', 69), sabor('Catupiry', 79), legado]
    const r = resolverPizza({
      itemNome: 'Pizza Salgada',
      tamanho: TAM_GRANDE,
      saborTexto: 'Frango / Catupiry',
      catalogo: comAmbos,
      regra: 'media',
    })
    expect(r).toEqual({ base: 99, saborNome: 'Frango / Catupiry' })
  })

  it('sabor legado pausado continua sendo recusado pelo nome inteiro', () => {
    const pausado = sabor('Frango / Catupiry', 99, 'pausado')
    expect(() =>
      resolverPizza({ itemNome: 'Pizza Salgada', tamanho: TAM_GRANDE, saborTexto: 'Frango / Catupiry', catalogo: [pausado], regra: 'media' }),
    ).toThrow(/"Frango \/ Catupiry"/)
  })
})
