import { describe, expect, it } from 'vitest'
import { massaIgualAoPadrao, massasParaEscolha } from './massa-padrao'

describe('massa igual à opção padrão', () => {
  it('reconhece variações de nome, caixa e acento', () => {
    for (const n of ['Tradicional', ' tradicional ', 'Padrão', 'PADRAO', 'Massa tradicional', 'massa  padrão', 'Normal']) {
      expect(massaIgualAoPadrao(n)).toBe(true)
    }
    for (const n of ['Fina', 'Integral', 'Tradicional fina', 'Sem glúten']) expect(massaIgualAoPadrao(n)).toBe(false)
  })

  it('esconde da escolha só a sem custo — o caso visto: "Tradicional" duas vezes no garçom', () => {
    const massas = [
      { nome: 'Tradicional', preco: 0 },
      { nome: 'Fina', preco: 3 },
    ]
    expect(massasParaEscolha(massas).map((m) => m.nome)).toEqual(['Fina'])
  })

  it('massa com o nome do padrão MAS com preço é outra oferta e continua', () => {
    expect(massasParaEscolha([{ nome: 'Tradicional', preco: 2 }]).map((m) => m.nome)).toEqual(['Tradicional'])
  })

  it('não altera a lista original (nada é apagado)', () => {
    const massas = [{ nome: 'Padrão', preco: 0 }]
    massasParaEscolha(massas)
    expect(massas).toHaveLength(1)
  })
})
