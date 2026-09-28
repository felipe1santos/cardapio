import { describe, it, expect } from 'vitest'
import { nomeLimpo, nomeTemFormatacao, pedacosDoNome } from './nome-item'

describe('nome do item na vitrine', () => {
  it('caso real: negrito + vermelho dentro do nome vira texto limpo', () => {
    expect(nomeLimpo('Bolo **[[vermelho]]Duplo[[/]]** Recheio 😎')).toBe('Bolo Duplo Recheio 😎')
  })

  it('o trecho marcado sai vermelho e negrito para desenhar', () => {
    const p = pedacosDoNome('Bolo **[[vermelho]]Duplo[[/]]** Recheio 😎')
    expect(p.map((x) => x.texto)).toEqual(['Bolo ', 'Duplo', ' Recheio 😎'])
    expect(p[1]).toMatchObject({ negrito: true, cor: '#DC2626' })
    expect(p[0]).toMatchObject({ negrito: false, cor: null })
    expect(nomeTemFormatacao('Bolo **[[vermelho]]Duplo[[/]]** Recheio 😎')).toBe(true)
  })

  it('nome com emoji e nome normal passam intactos', () => {
    expect(nomeLimpo('X-Tudo 🍔🔥')).toBe('X-Tudo 🍔🔥')
    expect(nomeLimpo('Pizza Calabresa')).toBe('Pizza Calabresa')
    expect(nomeTemFormatacao('Pizza Calabresa')).toBe(false)
    expect(pedacosDoNome('Pizza Calabresa')).toEqual([{ texto: 'Pizza Calabresa', negrito: false, cor: null }])
  })

  it('marcador solto some em vez de aparecer para o cliente', () => {
    expect(nomeLimpo('Bolo **Duplo')).toBe('Bolo Duplo')
    expect(nomeLimpo('Bolo [[vermelho]]Duplo')).toBe('Bolo Duplo')
    expect(nomeLimpo('Bolo Duplo[[/]] Recheio')).toBe('Bolo Duplo Recheio')
    expect(nomeLimpo('[[azul|b]]Açaí[[/]] 500ml')).toBe('Açaí 500ml')
    expect(nomeLimpo('Bolo [[dourado]]Duplo[[/]]')).toBe('Bolo Duplo')
    expect(nomeLimpo('Bolo **** Duplo')).toBe('Bolo Duplo')
  })

  it('vazio e nulo', () => {
    expect(nomeLimpo('')).toBe('')
    expect(nomeLimpo(null)).toBe('')
    expect(pedacosDoNome(undefined)).toEqual([])
  })

  it('texto já limpo continua igual ao limpar de novo', () => {
    const uma = nomeLimpo('Bolo **[[vermelho]]Duplo[[/]]** Recheio 😎')
    expect(nomeLimpo(uma)).toBe(uma)
  })
})
