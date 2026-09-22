import { describe, it, expect } from 'vitest'
import { BANNER_PROMO_MAX_IMAGENS, bannerPromocional, ehCarrossel } from './banner-promocional'

describe('bannerPromocional', () => {
  it('sem nada configurado, não mostra faixa nenhuma', () => {
    expect(bannerPromocional({})).toEqual({ tipo: 'nenhum' })
    expect(bannerPromocional({ urls: [], urlLegado: null, texto: null })).toEqual({ tipo: 'nenhum' })
    expect(bannerPromocional({ texto: '   ' })).toEqual({ tipo: 'nenhum' })
  })

  it('a lista nova de imagens é o caminho principal', () => {
    expect(bannerPromocional({ urls: ['a.png', 'b.png'] })).toEqual({ tipo: 'imagens', urls: ['a.png', 'b.png'] })
  })

  /** Loja que já tinha banner não pode perder o banner por causa da coluna nova. */
  it('a imagem antiga continua valendo sozinha', () => {
    expect(bannerPromocional({ urlLegado: 'antiga.png' })).toEqual({ tipo: 'imagens', urls: ['antiga.png'] })
  })

  it('a antiga entra no fim da lista nova, não no lugar dela', () => {
    expect(bannerPromocional({ urls: ['nova.png'], urlLegado: 'antiga.png' })).toEqual({
      tipo: 'imagens',
      urls: ['nova.png', 'antiga.png'],
    })
  })

  it('não duplica quando a antiga já está na lista', () => {
    expect(bannerPromocional({ urls: ['x.png'], urlLegado: 'x.png' })).toEqual({ tipo: 'imagens', urls: ['x.png'] })
  })

  it('imagem ganha do texto — quem subiu foto quis a foto', () => {
    expect(bannerPromocional({ urls: ['a.png'], texto: 'Promoção!' })).toEqual({ tipo: 'imagens', urls: ['a.png'] })
  })

  it('sem imagem, o aviso em texto ocupa a faixa', () => {
    expect(bannerPromocional({ texto: '  Hoje fechamos às 22h  ' })).toEqual({ tipo: 'texto', texto: 'Hoje fechamos às 22h' })
  })

  it('url vazia ou só espaço não conta como imagem', () => {
    expect(bannerPromocional({ urls: ['', '   '], texto: 'Aviso' })).toEqual({ tipo: 'texto', texto: 'Aviso' })
  })

  it('corta no teto de imagens da faixa', () => {
    const muitas = Array.from({ length: 12 }, (_, i) => `${i}.png`)
    const r = bannerPromocional({ urls: muitas })
    expect(r.tipo === 'imagens' && r.urls).toHaveLength(BANNER_PROMO_MAX_IMAGENS)
  })

  it('corta o texto no limite, em vez de estourar a faixa', () => {
    const r = bannerPromocional({ texto: 'x'.repeat(300) })
    expect(r.tipo === 'texto' && r.texto.length).toBe(140)
  })
})

describe('ehCarrossel', () => {
  it('só com mais de uma imagem: uma sozinha não tem o que passar', () => {
    expect(ehCarrossel(bannerPromocional({ urls: ['a.png'] }))).toBe(false)
    expect(ehCarrossel(bannerPromocional({ urls: ['a.png', 'b.png'] }))).toBe(true)
    expect(ehCarrossel(bannerPromocional({ texto: 'oi' }))).toBe(false)
    expect(ehCarrossel(bannerPromocional({}))).toBe(false)
  })
})
