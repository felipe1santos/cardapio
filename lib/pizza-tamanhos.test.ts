import { describe, expect, it } from 'vitest'
import { precoDoSaborNoTamanho, situacaoTamanhoPizza, tamanhoOcultoNaPizza, tamanhosVendidosDaPizza } from './pizza-tamanhos'

const P = { id: 'p', nome: 'Pequena' }
const M = { id: 'm', nome: 'Média' }
const G = { id: 'g', nome: 'Grande' }
const tamanhos = [P, M, G]

describe('tamanhosVendidosDaPizza', () => {
  it('mostra só tamanhos com preço em algum sabor (regra de antes da 0097)', () => {
    const sabores = [{ precos: [{ tamanhoPadraoId: 'm', preco: 40 }] }, { precos: [{ tamanhoPadraoId: 'g', preco: 0 }] }]
    expect(tamanhosVendidosDaPizza(tamanhos, sabores)).toEqual([M])
  })

  it('sem nenhum preço mostra todos — comportamento preservado', () => {
    expect(tamanhosVendidosDaPizza(tamanhos, [{ precos: [] }])).toEqual(tamanhos)
    expect(tamanhosVendidosDaPizza(tamanhos, [])).toEqual(tamanhos)
  })

  it('tamanho desligado some mesmo com preço, sem mexer nos outros', () => {
    const sabores = [{ precos: [{ tamanhoPadraoId: 'p', preco: 30 }, { tamanhoPadraoId: 'g', preco: 60 }] }]
    expect(tamanhosVendidosDaPizza(tamanhos, sabores, ['g'])).toEqual([P])
  })

  it('desligado some também no caso sem preço', () => {
    expect(tamanhosVendidosDaPizza(tamanhos, [], ['p'])).toEqual([M, G])
  })

  it('aceita o formato de mapa usado no QR da mesa', () => {
    const sabores = [{ precos: { p: 25 } as Record<string, number> }]
    expect(tamanhosVendidosDaPizza(tamanhos, sabores)).toEqual([P])
  })

  it('ocultos nulo equivale a vazio (linha lida antes da 0097)', () => {
    const sabores = [{ precos: [{ tamanhoPadraoId: 'm', preco: 40 }] }]
    expect(tamanhosVendidosDaPizza(tamanhos, sabores, null)).toEqual([M])
  })
})

describe('situacaoTamanhoPizza', () => {
  const sabores = [
    { precos: [{ tamanhoPadraoId: 'm', preco: 40 }, { tamanhoPadraoId: 'g', preco: 55 }] },
    { precos: [{ tamanhoPadraoId: 'g', preco: 60 }] },
  ]
  it('classifica cada coluna', () => {
    expect(situacaoTamanhoPizza('p', sabores)).toBe('sem_preco')
    expect(situacaoTamanhoPizza('m', sabores)).toBe('parcial')
    expect(situacaoTamanhoPizza('g', sabores)).toBe('completo')
    expect(situacaoTamanhoPizza('g', sabores, ['g'])).toBe('desligado')
  })
})

describe('auxiliares', () => {
  it('preço ausente vale 0 nos dois formatos', () => {
    expect(precoDoSaborNoTamanho([], 'x')).toBe(0)
    expect(precoDoSaborNoTamanho({}, 'x')).toBe(0)
  })
  it('oculto', () => {
    expect(tamanhoOcultoNaPizza(undefined, 'x')).toBe(false)
    expect(tamanhoOcultoNaPizza(['x'], 'x')).toBe(true)
  })
})
