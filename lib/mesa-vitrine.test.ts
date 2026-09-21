import { describe, it, expect } from 'vitest'
import {
  carrosselValido,
  mensagemPadraoDaMesa,
  mensagemValida,
  ordemValida,
  ordenarParaMesa,
  MESA_CARROSSEL_MAX,
} from './mesa-vitrine'

const BASE = { supabaseUrl: 'https://x.supabase.co', restauranteId: 'loja-1' }
const img = (n: number) => `https://x.supabase.co/storage/v1/object/public/cardapio/loja-1/perfil/mesa-carrossel-${n}.webp`

describe('carrossel da mesa', () => {
  it('aceita imagens da pasta da loja, sem repetição', () => {
    expect(carrosselValido([img(1), img(2), img(1)], BASE)).toEqual({ ok: true, urls: [img(1), img(2)] })
  })
  it('recusa imagem externa, de outra loja ou com caminho estranho', () => {
    expect(carrosselValido(['https://evil.com/a.jpg'], BASE).ok).toBe(false)
    expect(carrosselValido(['https://x.supabase.co/storage/v1/object/public/cardapio/loja-2/a.jpg'], BASE).ok).toBe(false)
    expect(carrosselValido([img(1).replace('perfil/', 'perfil/../../')], BASE).ok).toBe(false)
  })
  it(`no máximo ${MESA_CARROSSEL_MAX}`, () => {
    expect(carrosselValido(Array.from({ length: MESA_CARROSSEL_MAX + 1 }, (_, i) => img(i)), BASE).ok).toBe(false)
  })
})

describe('mensagem da seleção', () => {
  it('vazia volta ao padrão; espaços são normalizados', () => {
    expect(mensagemValida('   ')).toEqual({ ok: true, texto: null })
    expect(mensagemValida('  Mostre  ao garçom ')).toEqual({ ok: true, texto: 'Mostre ao garçom' })
  })
  it('acima de 280 é recusada', () => {
    expect(mensagemValida('x'.repeat(281)).ok).toBe(false)
  })
  it('o padrão só fala em seleção quando existe seleção', () => {
    expect(mensagemPadraoDaMesa(false)).toContain('sua seleção')
    expect(mensagemPadraoDaMesa(true)).not.toContain('seleção')
    expect(mensagemPadraoDaMesa(true)).toContain('consultar')
  })
})

describe('ordem dos itens na mesa', () => {
  it('só ids da loja, posições 1..n sem repetição', () => {
    const r = ordemValida(['b', 'a', 'b'], new Set(['a', 'b', 'c']))
    expect(r).toEqual({ ok: true, posicoes: [{ id: 'b', posicao: 1 }, { id: 'a', posicao: 2 }] })
    expect(ordemValida(['z'], new Set(['a'])).ok).toBe(false)
  })
  it('ordenados primeiro; sem posição depois, na ordem de sempre', () => {
    const itens = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const pos = new Map<string, number | null>([['c', 1], ['a', 2], ['b', null]])
    expect(ordenarParaMesa(itens, pos).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})
