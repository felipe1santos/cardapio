import { describe, expect, it } from 'vitest'
import { impressorasDoAvancado, perguntarSaiuCertinho, sugerirTexto } from './avancado'

describe('Avançado da impressão (Alfa 1)', () => {
  it('"Saiu certinho?" só depois do primeiro teste e enquanto não respondeu', () => {
    expect(perguntarSaiuCertinho({ testeEnviado: true, resposta: null })).toBe(true)
    expect(perguntarSaiuCertinho({ testeEnviado: false, resposta: null })).toBe(false)
    expect(perguntarSaiuCertinho({ testeEnviado: true, resposta: 'ok' })).toBe(false)
  })
  it('"Não saiu direito" em Imagem sugere Texto; em Texto não', () => {
    expect(sugerirTexto({ resposta: 'nao_saiu', modo: 'imagem' })).toBe(true)
    expect(sugerirTexto({ resposta: 'nao_saiu', modo: 'texto' })).toBe(false)
    expect(sugerirTexto({ resposta: 'ok', modo: 'imagem' })).toBe(false)
  })
  it('lista as impressoras da tela e as que têm função', () => {
    const l = [{ id: 'a', naLista: true, funcoes: [] }, { id: 'b', naLista: false, funcoes: ['cozinha'] }, { id: 'c', naLista: false, funcoes: [] }]
    expect(impressorasDoAvancado(l).map((d) => d.id)).toEqual(['a', 'b'])
  })
})
