import { describe, it, expect } from 'vitest'
import {
  SEPARADOR_SABORES,
  juntarSabores,
  separarSabores,
  precoPizzaSabores,
  nomeTemSeparador,
} from './pizza-preco'

describe('juntarSabores / separarSabores', () => {
  it('junta e separa preservando a ordem', () => {
    const nomes = ['Calabresa', 'Frango C/ Catupiry']
    expect(juntarSabores(nomes)).toBe('Calabresa / Frango C/ Catupiry')
    expect(separarSabores(juntarSabores(nomes))).toEqual(nomes)
  })

  it('um sabor só vira o próprio nome, sem separador', () => {
    expect(juntarSabores(['Portuguesa'])).toBe('Portuguesa')
    expect(separarSabores('Portuguesa')).toEqual(['Portuguesa'])
  })

  it('texto vazio vira lista vazia', () => {
    expect(separarSabores('')).toEqual([])
    expect(separarSabores('   ')).toEqual([])
  })

  it('não confunde "C/" no meio do nome com o separador', () => {
    expect(separarSabores('Bacon C/ Milho')).toEqual(['Bacon C/ Milho'])
    expect(separarSabores('Bacon C/ Milho / Calabresa')).toEqual(['Bacon C/ Milho', 'Calabresa'])
  })

  it('nomeTemSeparador acusa nome que quebraria o round-trip', () => {
    expect(nomeTemSeparador('Calabresa / Frango')).toBe(true)
    expect(nomeTemSeparador('Bacon C/ Milho')).toBe(false)
    expect(SEPARADOR_SABORES).toBe(' / ')
  })
})

describe('precoPizzaSabores', () => {
  it('um sabor devolve o preço dele, nas duas regras', () => {
    expect(precoPizzaSabores([89], 'media')).toBe(89)
    expect(precoPizzaSabores([89], 'maior')).toBe(89)
  })

  it('media tira a média aritmética', () => {
    expect(precoPizzaSabores([89, 99], 'media')).toBe(94)
    expect(precoPizzaSabores([89, 99, 109], 'media')).toBe(99)
  })

  it('maior pega o sabor mais caro', () => {
    expect(precoPizzaSabores([89, 99], 'maior')).toBe(99)
    expect(precoPizzaSabores([109, 89, 99], 'maior')).toBe(109)
  })

  it('arredonda a média pra 2 casas, sem sobra de centavo', () => {
    expect(precoPizzaSabores([89, 99, 100], 'media')).toBe(96)
    expect(precoPizzaSabores([69, 70], 'media')).toBe(69.5)
    expect(precoPizzaSabores([10, 10, 10.01], 'media')).toBe(10)
  })

  it('lista vazia é zero', () => {
    expect(precoPizzaSabores([], 'media')).toBe(0)
    expect(precoPizzaSabores([], 'maior')).toBe(0)
  })
})
