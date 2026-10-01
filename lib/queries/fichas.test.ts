import { describe, it, expect } from 'vitest'
import { normalizarFicha, fichaVazia } from './fichas'

describe('ficha de preparo (5.3)', () => {
  it('limpa linhas vazias, corta tamanhos e aceita só foto https', () => {
    const f = normalizarFicha({
      ingredientes: [{ nome: ' Pão ', quantidade: '1 un' }, { nome: '', quantidade: 'x' }],
      passos: [{ texto: 'Grelhar', fotoUrl: 'http://x/a.jpg' }, { texto: 'Montar', fotoUrl: 'https://x/b.jpg' }, { texto: '  ' }],
      tempoMin: '12',
    })
    expect(f.ingredientes).toEqual([{ nome: 'Pão', quantidade: '1 un' }])
    expect(f.passos).toEqual([{ texto: 'Grelhar', fotoUrl: null }, { texto: 'Montar', fotoUrl: 'https://x/b.jpg' }])
    expect(f.tempoMin).toBe(12)
  })
  it('tempo fora de 1..600 vira null; vazia é reconhecida', () => {
    expect(normalizarFicha({ tempoMin: 0 }).tempoMin).toBeNull()
    expect(fichaVazia(normalizarFicha({}))).toBe(true)
    expect(fichaVazia(normalizarFicha({ tempoMin: 5 }))).toBe(false)
  })
})
