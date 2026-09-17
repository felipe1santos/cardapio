import { describe, it, expect } from 'vitest'
import { dividirPorPessoas, trocoPara, centavos, mensagemDeErroConta, ehForma } from './conta'

describe('dividirPorPessoas', () => {
  it('fecha o centavo: a soma das partes é sempre o total', () => {
    for (const [total, pessoas] of [[100, 3], [74.8, 3], [10, 7], [0.05, 2], [199.99, 4], [1, 3]] as const) {
      const partes = dividirPorPessoas(total, pessoas)
      expect(partes).toHaveLength(pessoas)
      const soma = Math.round(partes.reduce((s, p) => s + p, 0) * 100)
      expect(soma, `${total} / ${pessoas}`).toBe(Math.round(total * 100))
    }
  })

  it('a sobra cai nas primeiras partes, um centavo por vez', () => {
    expect(dividirPorPessoas(100, 3)).toEqual([33.34, 33.33, 33.33])
  })

  it('divisão exata não inventa centavo', () => {
    expect(dividirPorPessoas(90, 3)).toEqual([30, 30, 30])
  })

  it('entrada inválida não divide', () => {
    expect(dividirPorPessoas(0, 3)).toEqual([])
    expect(dividirPorPessoas(100, 0)).toEqual([])
    expect(dividirPorPessoas(Number.NaN, 2)).toEqual([])
  })
})

describe('trocoPara', () => {
  it('calcula troco sem erro de ponto flutuante', () => {
    expect(trocoPara(44.8, 50)).toBe(5.2)
    expect(trocoPara(0.1 + 0.2, 1)).toBe(0.7)
  })

  it('recebido menor que o valor não dá troco negativo', () => {
    expect(trocoPara(50, 20)).toBe(0)
  })
})

describe('centavos', () => {
  it('arredonda o clássico 1.005', () => {
    expect(centavos(1.005)).toBe(1.01)
    expect(centavos(74.8)).toBe(74.8)
  })
})

describe('mensagemDeErroConta', () => {
  it('traduz saldo restante com o valor', () => {
    const m = mensagemDeErroConta('saldo_restante:12.30')
    expect(m).toContain('Ainda falta receber')
    expect(m).toContain('12,30')
  })

  it('aceita a mensagem com o prefixo que o PostgREST adiciona', () => {
    expect(mensagemDeErroConta('ERROR: destino_ocupado')).toContain('já tem conta aberta')
  })

  it('código desconhecido não vaza detalhe interno', () => {
    expect(mensagemDeErroConta('relation "x" does not exist')).toBe('Não foi possível concluir a operação.')
    expect(mensagemDeErroConta(null)).toBe('Não foi possível concluir a operação.')
  })
})

describe('ehForma', () => {
  it('só as formas cadastradas', () => {
    expect(ehForma('pix')).toBe(true)
    expect(ehForma('fiado')).toBe(true)
    expect(ehForma('bitcoin')).toBe(false)
    expect(ehForma(null)).toBe(false)
  })
})
