import { describe, it, expect } from 'vitest'
import {
  aplicarMarcacao,
  descricaoEmTextoPuro,
  pedacosDaDescricao,
  temFormatacao,
  CORES_DESCRICAO,
} from './descricao-rica'

const roxo = '#7C3AED'

describe('pedacosDaDescricao', () => {
  it('texto sem marcação vira um pedaço só', () => {
    expect(pedacosDaDescricao('Pão brioche com queijo')).toEqual([
      { texto: 'Pão brioche com queijo', negrito: false, cor: null },
    ])
  })

  it('vazio e nulo não geram pedaço nenhum', () => {
    expect(pedacosDaDescricao('')).toEqual([])
    expect(pedacosDaDescricao(null)).toEqual([])
    expect(pedacosDaDescricao(undefined)).toEqual([])
  })

  it('negrito no meio da frase', () => {
    expect(pedacosDaDescricao('Serve **2 pessoas** com tranquilidade')).toEqual([
      { texto: 'Serve ', negrito: false, cor: null },
      { texto: '2 pessoas', negrito: true, cor: null },
      { texto: ' com tranquilidade', negrito: false, cor: null },
    ])
  })

  it('cor, e cor com negrito', () => {
    expect(pedacosDaDescricao('[[roxo]]Novidade[[/]]')).toEqual([{ texto: 'Novidade', negrito: false, cor: roxo }])
    expect(pedacosDaDescricao('[[roxo|b]]Novidade[[/]]')).toEqual([{ texto: 'Novidade', negrito: true, cor: roxo }])
  })

  it('marcações seguidas mantêm a ordem e o texto entre elas', () => {
    expect(pedacosDaDescricao('a **b** c [[verde]]d[[/]] e')).toEqual([
      { texto: 'a ', negrito: false, cor: null },
      { texto: 'b', negrito: true, cor: null },
      { texto: ' c ', negrito: false, cor: null },
      { texto: 'd', negrito: false, cor: '#15803D' },
      { texto: ' e', negrito: false, cor: null },
    ])
  })

  it('cada cor da paleta resolve para o seu valor', () => {
    for (const c of CORES_DESCRICAO) {
      expect(pedacosDaDescricao(`[[${c.id}]]x[[/]]`)).toEqual([{ texto: 'x', negrito: false, cor: c.valor }])
    }
  })

  /** A descrição é digitada à mão: o que não for marcação precisa sobreviver como texto. */
  describe('o que não é marcação fica literal', () => {
    it('cor fora da paleta', () => {
      expect(pedacosDaDescricao('[[dourado]]x[[/]]')).toEqual([
        { texto: '[[dourado]]x[[/]]', negrito: false, cor: null },
      ])
    })

    it('asterisco solto e marcação sem fechar', () => {
      expect(pedacosDaDescricao('promo ** sem par')).toEqual([{ texto: 'promo ** sem par', negrito: false, cor: null }])
      expect(pedacosDaDescricao('[[roxo]]sem fim')).toEqual([{ texto: '[[roxo]]sem fim', negrito: false, cor: null }])
    })

    it('colchete perdido', () => {
      expect(pedacosDaDescricao('serve 2 [porções]')).toEqual([{ texto: 'serve 2 [porções]', negrito: false, cor: null }])
    })

    it('negrito vazio não vira pedaço em branco', () => {
      expect(pedacosDaDescricao('a ****  b')).toEqual([{ texto: 'a ****  b', negrito: false, cor: null }])
    })

    it('marcação que atravessa quebra de linha continua valendo', () => {
      expect(pedacosDaDescricao('**duas\nlinhas**')).toEqual([{ texto: 'duas\nlinhas', negrito: true, cor: null }])
    })
  })

  /**
   * Acontece de verdade: o lojista seleciona um trecho já destacado e clica no
   * outro botão. Sem ler o aninhamento, os colchetes iam crus para o cardápio.
   */
  describe('marcação dentro de marcação', () => {
    it('negrito por fora da cor herda as duas', () => {
      expect(pedacosDaDescricao('**[[roxo]]molho da casa[[/]]**')).toEqual([
        { texto: 'molho da casa', negrito: true, cor: roxo },
      ])
    })

    it('cor por fora do negrito herda as duas', () => {
      expect(pedacosDaDescricao('[[verde]]tem **bacon** aqui[[/]]')).toEqual([
        { texto: 'tem ', negrito: false, cor: '#15803D' },
        { texto: 'bacon', negrito: true, cor: '#15803D' },
        { texto: ' aqui', negrito: false, cor: '#15803D' },
      ])
    })

    it('a cor de dentro vence a de fora', () => {
      expect(pedacosDaDescricao('[[verde]]a [[roxo]]b[[/]][[/]]')).toEqual([
        { texto: 'a ', negrito: false, cor: '#15803D' },
        { texto: 'b', negrito: false, cor: roxo },
      ])
    })

    it('aninhamento absurdo para de descer e devolve o texto', () => {
      const fundo = '**'.repeat(12) + 'x' + '**'.repeat(12)
      expect(() => pedacosDaDescricao(fundo)).not.toThrow()
      expect(descricaoEmTextoPuro(fundo)).toContain('x')
    })
  })

  it('não interpreta HTML: tag digitada é texto', () => {
    const bruto = '<script>alert(1)</script> e <b>negrito</b>'
    expect(pedacosDaDescricao(bruto)).toEqual([{ texto: bruto, negrito: false, cor: null }])
  })
})

describe('temFormatacao', () => {
  it('só é verdadeiro quando há marcação válida', () => {
    expect(temFormatacao('texto simples')).toBe(false)
    expect(temFormatacao('[[dourado]]x[[/]]')).toBe(false)
    expect(temFormatacao('**x**')).toBe(true)
    expect(temFormatacao('[[azul]]x[[/]]')).toBe(true)
    expect(temFormatacao(null)).toBe(false)
  })
})

describe('descricaoEmTextoPuro', () => {
  it('devolve a frase sem os marcadores — é o que vai pro recibo e pro WhatsApp', () => {
    expect(descricaoEmTextoPuro('Serve **2 pessoas** com [[roxo]]molho da casa[[/]]')).toBe(
      'Serve 2 pessoas com molho da casa',
    )
  })

  it('texto sem marcação passa igual', () => {
    expect(descricaoEmTextoPuro('Batata frita')).toBe('Batata frita')
    expect(descricaoEmTextoPuro(null)).toBe('')
  })
})

describe('aplicarMarcacao', () => {
  it('envolve a seleção em negrito e devolve a nova seleção', () => {
    const r = aplicarMarcacao('Serve 2 pessoas', 6, 15, { tipo: 'negrito' })
    expect(r.texto).toBe('Serve **2 pessoas**')
    expect(r.texto.slice(r.selecao[0], r.selecao[1])).toBe('**2 pessoas**')
  })

  it('envolve em cor, com e sem negrito', () => {
    expect(aplicarMarcacao('abc', 0, 3, { tipo: 'cor', cor: 'roxo' }).texto).toBe('[[roxo]]abc[[/]]')
    expect(aplicarMarcacao('abc', 0, 3, { tipo: 'cor', cor: 'roxo', negrito: true }).texto).toBe('[[roxo|b]]abc[[/]]')
  })

  it('clicar de novo em Negrito sobre um trecho já negrito tira a marcação', () => {
    const r = aplicarMarcacao('a **bacon** b', 2, 11, { tipo: 'negrito' })
    expect(r.texto).toBe('a bacon b')
  })

  it('trocar a cor de um trecho já colorido substitui, não empilha', () => {
    const r = aplicarMarcacao('[[verde]]x[[/]]', 0, 15, { tipo: 'cor', cor: 'roxo' })
    expect(r.texto).toBe('[[roxo]]x[[/]]')
    expect(pedacosDaDescricao(r.texto)).toEqual([{ texto: 'x', negrito: false, cor: roxo }])
  })

  it('sem seleção não mexe no texto — nada de marcador vazio pra caçar depois', () => {
    const r = aplicarMarcacao('abc', 2, 2, { tipo: 'negrito' })
    expect(r).toEqual({ texto: 'abc', selecao: [2, 2] })
  })

  it('o que foi aplicado é o que o parser lê de volta', () => {
    const { texto } = aplicarMarcacao('Molho especial da casa', 0, 14, { tipo: 'cor', cor: 'verde', negrito: true })
    expect(pedacosDaDescricao(texto)).toEqual([
      { texto: 'Molho especial', negrito: true, cor: '#15803D' },
      { texto: ' da casa', negrito: false, cor: null },
    ])
  })
})
