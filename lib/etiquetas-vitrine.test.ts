import { describe, it, expect } from 'vitest'
import { etiquetasPrincipais, etiquetasUtilitarias, percentualDesconto } from './etiquetas-vitrine'

const agora = Date.parse('2026-10-01T12:00:00Z')
const futuro = '2026-10-20T00:00:00Z'
const passado = '2026-09-01T00:00:00Z'

describe('etiquetas principais (3.3)', () => {
  it('ordem: Mais pedido, Novidade, Edição limitada — no máximo 2', () => {
    expect(etiquetasPrincipais({ maisVendido: true, novidadeAte: futuro, edicaoLimitada: true }, agora)).toEqual(['mais_pedido', 'novidade'])
    expect(etiquetasPrincipais({ maisVendido: false, novidadeAte: futuro, edicaoLimitada: true }, agora)).toEqual(['novidade', 'edicao_limitada'])
  })
  it('Novidade some depois da data', () => {
    expect(etiquetasPrincipais({ novidadeAte: passado, edicaoLimitada: false }, agora)).toEqual([])
  })
  it('estrela do Gestor (antigo "Favorito") vira Mais pedido', () => {
    expect(etiquetasPrincipais({ maisVendido: true }, agora)).toEqual(['mais_pedido'])
  })
  it('item salvo antes da 0117: entende a tag antiga', () => {
    expect(etiquetasPrincipais({ tag: 'novo' }, agora)).toEqual(['novidade'])
    expect(etiquetasPrincipais({ tag: 'edicao_limitada' }, agora)).toEqual(['edicao_limitada'])
    expect(etiquetasPrincipais({ tag: 'favorito' }, agora)).toEqual(['mais_pedido'])
  })
  it('tag antiga ainda vale mesmo com as colunas novas em falso (item salvo por aba antiga)', () => {
    expect(etiquetasPrincipais({ tag: 'edicao_limitada', novidadeAte: null, edicaoLimitada: false }, agora)).toEqual(['edicao_limitada'])
  })
})

describe('etiquetas utilitárias (3.3)', () => {
  it('ordem: Item promocional, Entrega grátis, Serve', () => {
    expect(etiquetasUtilitarias({ itemPromocional: true, entregaGratis: true, servePessoas: 4 }, { freteGratisAcima: 45 }).map((e) => e.texto))
      .toEqual(['Item promocional', 'Entrega grátis a partir de R$ 45', 'Serve 4 pessoas'])
  })
  it('sem regra da loja: só "Entrega grátis"; 1 pessoa no singular; centavos', () => {
    expect(etiquetasUtilitarias({ itemPromocional: false, entregaGratis: true, servePessoas: 1 }).map((e) => e.texto)).toEqual(['Entrega grátis', 'Serve 1 pessoa'])
    expect(etiquetasUtilitarias({ itemPromocional: false, entregaGratis: true }, { freteGratisAcima: 39.9 })[0].texto).toBe('Entrega grátis a partir de R$ 39,90')
  })
  it('tag antiga "promocao" vira Item promocional', () => {
    expect(etiquetasUtilitarias({ tag: 'promocao' })[0].texto).toBe('Item promocional')
  })
})

describe('desconto', () => {
  it('7,50 → 5,63 = 25%', () => expect(percentualDesconto(5.63, 7.5)).toBe(25))
  it('sem desconto = 0', () => expect(percentualDesconto(10, 10)).toBe(0))
})
