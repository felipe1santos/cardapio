import { describe, expect, it } from 'vitest'
import {
  ehMaisPedidos,
  etiquetasTopo,
  etiquetasTopoLigadas,
  etiquetasUtilitarias,
  limparTagPersonalizada,
  motivoTagPersonalizadaInvalida,
  percentualDesconto,
  textoServe,
} from './etiquetas-vitrine'
import { colunasEtiquetas } from './queries/cardapio'

const AGORA = Date.parse('2026-10-01T12:00:00Z')
const FUTURO = '2026-10-20T00:00:00Z'

describe('tags de topo: prioridade e limite', () => {
  it('ordem Combo especial > Oferta limitada > Novidade, no máximo 2; "Mais Pedidos" não é tag de topo (é selo na foto)', () => {
    const tudo = { maisVendido: true, comboEspecial: true, edicaoLimitada: true, novidadeAte: FUTURO }
    expect(etiquetasTopoLigadas(tudo, AGORA)).toEqual(['combo_especial', 'oferta_limitada', 'novidade'])
    expect(etiquetasTopo(tudo, 2, AGORA)).toEqual(['combo_especial', 'oferta_limitada'])
    expect(etiquetasTopo({ edicaoLimitada: true, novidadeAte: FUTURO, comboEspecial: true }, 2, AGORA)).toEqual(['combo_especial', 'oferta_limitada'])
  })
  it('destaques mostram só a mais importante; nunca passa de 2', () => {
    expect(etiquetasTopo({ comboEspecial: true, maisVendido: true }, 1, AGORA)).toEqual(['combo_especial'])
    expect(etiquetasTopo({ comboEspecial: true, maisVendido: true, edicaoLimitada: true }, 5, AGORA)).toHaveLength(2)
  })
  it('novidade vencida some', () => {
    expect(etiquetasTopo({ novidadeAte: '2026-09-01T00:00:00Z' }, 2, AGORA)).toEqual([])
  })
  it('sem tags = nada', () => {
    expect(etiquetasTopo({}, 2, AGORA)).toEqual([])
    expect(etiquetasUtilitarias({})).toEqual([])
  })
})

describe('migração das tags antigas (sem converter dado)', () => {
  it('Favorito/Mais pedido → "Mais Pedidos" (selo); Edição limitada → Oferta limitada; novo → Novidade; promoção → Item promocional', () => {
    expect(ehMaisPedidos({ tag: 'favorito' })).toBe(true)
    expect(ehMaisPedidos({ tag: 'mais_pedido' })).toBe(true)
    expect(ehMaisPedidos({ maisVendido: true })).toBe(true)
    expect(ehMaisPedidos({ tag: 'novo', maisVendido: false })).toBe(false)
    expect(etiquetasTopo({ tag: 'favorito' }, 2, AGORA)).toEqual([])
    expect(etiquetasTopo({ tag: 'edicao_limitada' }, 2, AGORA)).toEqual(['oferta_limitada'])
    expect(etiquetasTopo({ edicaoLimitada: true }, 2, AGORA)).toEqual(['oferta_limitada'])
    expect(etiquetasTopo({ tag: 'novo' }, 2, AGORA)).toEqual(['novidade'])
    expect(etiquetasUtilitarias({ tag: 'promocao' })).toEqual([{ tipo: 'item_promocional', texto: 'Item promocional' }])
  })
  it('tag antiga + coluna nova iguais não duplicam', () => {
    expect(etiquetasTopo({ tag: 'novo', novidadeAte: FUTURO }, 2, AGORA)).toEqual(['novidade'])
    expect(etiquetasUtilitarias({ tag: 'promocao', itemPromocional: true })).toHaveLength(1)
  })
})

describe('utilitárias', () => {
  it('Serve: singular com 1, "até X" no plural', () => {
    expect(textoServe(1)).toBe('Serve 1 pessoa')
    expect(textoServe(2)).toBe('Serve até 2 pessoas')
    expect(textoServe(10)).toBe('Serve até 10 pessoas')
    expect(etiquetasUtilitarias({ servePessoas: 1 })[0].texto).toBe('Serve 1 pessoa')
  })
  it('ordem: Serve, Item promocional, personalizada', () => {
    const l = etiquetasUtilitarias({ servePessoas: 4, itemPromocional: true, tagPersonalizada: 'Receita da casa', tagPersonalizadaCor: 'azul' })
    expect(l.map((e) => e.tipo)).toEqual(['serve', 'item_promocional', 'personalizada'])
    expect(l[2]).toEqual({ tipo: 'personalizada', texto: 'Receita da casa', cor: 'azul' })
  })
  it('personalizada igual a outra tag não duplica; cor inválida vira preta', () => {
    expect(etiquetasUtilitarias({ itemPromocional: true, tagPersonalizada: 'item promocional' })).toHaveLength(1)
    expect(etiquetasUtilitarias({ tagPersonalizada: 'X', tagPersonalizadaCor: 'verde' })[0]).toMatchObject({ cor: 'preta' })
  })
})

describe('tag personalizada: validação', () => {
  it('limpa: uma linha, até 24, vazio = null', () => {
    expect(limparTagPersonalizada('  Receita\n da casa  ')).toBe('Receita da casa')
    expect(limparTagPersonalizada('a'.repeat(30))).toHaveLength(24)
    expect(limparTagPersonalizada('   ')).toBeNull()
  })
  it('motivo', () => {
    expect(motivoTagPersonalizadaInvalida('Ok', 'preta')).toBeNull()
    expect(motivoTagPersonalizadaInvalida('', 'preta')).toBeNull()
    expect(motivoTagPersonalizadaInvalida('a'.repeat(25), 'preta')).toMatch(/24/)
    expect(motivoTagPersonalizadaInvalida('a\nb', 'azul')).toMatch(/uma linha/)
    expect(motivoTagPersonalizadaInvalida('Ok', 'verde')).toMatch(/cor/)
  })
  it('colunasEtiquetas grava a personalizada limpa e o combo', () => {
    const c = colunasEtiquetas({ novidade: false, edicaoLimitada: true, itemPromocional: false, entregaGratis: false, servePessoas: 2, comboEspecial: true, tagPersonalizada: ' Receita da casa ', tagPersonalizadaCor: 'azul' })
    expect(c).toMatchObject({ combo_especial: true, edicao_limitada: true, tag_personalizada: 'Receita da casa', tag_personalizada_cor: 'azul', serve_pessoas: 2, tag: null })
    const sem = colunasEtiquetas({ novidade: false, edicaoLimitada: false, itemPromocional: false, entregaGratis: false, servePessoas: null, tagPersonalizada: null })
    expect(sem).toMatchObject({ tag_personalizada: null, tag_personalizada_cor: 'preta' })
  })
})

describe('desconto', () => {
  it('percentual inteiro', () => {
    expect(percentualDesconto(5.63, 7.5)).toBe(25)
    expect(percentualDesconto(10, 10)).toBe(0)
    expect(percentualDesconto(12, 10)).toBe(0)
    expect(percentualDesconto(5, 0)).toBe(0)
  })
})
