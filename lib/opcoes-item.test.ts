import { describe, it, expect } from 'vitest'
import { validarOpcoes, minimoDoGrupo, maximoDoGrupo, type GrupoOpcoesRegra } from './opcoes-item'

const PONTO: GrupoOpcoesRegra = {
  nome: 'Escolha o ponto', obrigatorio: true, minEscolhas: 1, maxEscolhas: 1,
  opcoes: ['Ao ponto', 'Mal passado', 'Bem passado'],
}
const ADICIONAIS: GrupoOpcoesRegra = {
  nome: 'Adicionais', obrigatorio: false, minEscolhas: 0, maxEscolhas: 2,
  opcoes: ['Bacon', 'Cheddar', 'Cebola'],
}
const BEBIDA: GrupoOpcoesRegra = {
  nome: 'Escolha a bebida', obrigatorio: true, minEscolhas: 1, maxEscolhas: 1,
  opcoes: ['Coca-Cola', 'Suco'],
}
const BURGER = [PONTO, ADICIONAIS, BEBIDA]

describe('validarOpcoes', () => {
  it('aceita escolha completa', () => {
    expect(validarOpcoes(BURGER, ['Ao ponto', 'Coca-Cola'])).toEqual([])
    expect(validarOpcoes(BURGER, ['Ao ponto', 'Bacon', 'Cheddar', 'Suco'])).toEqual([])
  })

  it('recusa burger sem ponto — o caso que motivou a regra', () => {
    const erros = validarOpcoes(BURGER, ['Coca-Cola'])
    expect(erros).toHaveLength(1)
    expect(erros[0]).toContain('Escolha o ponto')
  })

  it('recusa sem nada escolhido, apontando cada obrigatório', () => {
    const erros = validarOpcoes(BURGER, [])
    expect(erros).toHaveLength(2)
  })

  it('escolha de um grupo não responde outro grupo', () => {
    // "Bacon" é de Adicionais; não conta como ponto nem como bebida.
    expect(validarOpcoes(BURGER, ['Bacon'])).toHaveLength(2)
  })

  it('recusa passar do máximo', () => {
    const erros = validarOpcoes(BURGER, ['Ao ponto', 'Mal passado', 'Coca-Cola'])
    expect(erros.some((e) => e.includes('no máximo 1'))).toBe(true)
    expect(validarOpcoes(BURGER, ['Ao ponto', 'Bacon', 'Cheddar', 'Cebola', 'Suco']).some((e) => e.includes('no máximo 2'))).toBe(true)
  })

  it('recusa opção que não existe (pausada, removida ou inventada)', () => {
    const erros = validarOpcoes(BURGER, ['Ao ponto', 'Coca-Cola', 'Lagosta'])
    expect(erros).toEqual(['A opção "Lagosta" não está disponível.'])
  })

  it('item sem grupos aceita lista vazia e recusa qualquer opção', () => {
    expect(validarOpcoes([], [])).toEqual([])
    expect(validarOpcoes([], ['Bacon'])).toHaveLength(1)
  })

  it('grupo obrigatório sem opções não trava o item', () => {
    // Todas as opções pausadas: melhor deixar lançar do que travar a mesa inteira.
    const vazio = { ...PONTO, opcoes: [] }
    expect(validarOpcoes([vazio], [])).toEqual([])
  })
})

describe('limites do grupo', () => {
  it('obrigatório sem mínimo cadastrado exige 1', () => {
    expect(minimoDoGrupo({ obrigatorio: true, minEscolhas: 0 })).toBe(1)
    expect(minimoDoGrupo({ obrigatorio: true, minEscolhas: 2 })).toBe(2)
    expect(minimoDoGrupo({ obrigatorio: false, minEscolhas: 3 })).toBe(0)
  })

  it('máximo nunca passa do número de opções nem fica abaixo de 1', () => {
    expect(maximoDoGrupo({ maxEscolhas: 10, opcoes: ['a', 'b'] })).toBe(2)
    expect(maximoDoGrupo({ maxEscolhas: 0, opcoes: ['a', 'b'] })).toBe(1)
  })
})
