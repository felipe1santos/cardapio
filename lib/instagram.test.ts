import { describe, it, expect } from 'vitest'
import { arrobaDoInstagram, normalizarInstagram } from './instagram'

const REGEX_DO_BANCO = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{1,30}\/?$/

describe('Instagram da loja', () => {
  it.each([
    ['https://instagram.com/menuzia', 'https://instagram.com/menuzia'],
    ['https://www.instagram.com/villa.lanches/', 'https://instagram.com/villa.lanches'],
    ['http://instagram.com/pizza_do_rosa', 'https://instagram.com/pizza_do_rosa'],
    ['instagram.com/menuzia', 'https://instagram.com/menuzia'],
    ['www.instagram.com/menuzia?igsh=abc123', 'https://instagram.com/menuzia'],
    ['@menuzia', 'https://instagram.com/menuzia'],
    ['menuzia', 'https://instagram.com/menuzia'],
    ['  @Estancia.Burger  ', 'https://instagram.com/Estancia.Burger'],
  ])('aceita e normaliza %s', (entrada, url) => {
    const r = normalizarInstagram(entrada)
    expect(r).toEqual({ ok: true, url })
    expect(REGEX_DO_BANCO.test(url)).toBe(true)
  })

  it('vazio = sem Instagram (limpa o campo)', () => {
    expect(normalizarInstagram('')).toEqual({ ok: true, url: null })
    expect(normalizarInstagram(null)).toEqual({ ok: true, url: null })
  })

  it.each([
    'https://facebook.com/menuzia',
    'https://evil.com/instagram.com/x',
    'https://instagram.com.evil.com/x',
    'https://instagram.com/p/Cx123/',
    'https://instagram.com/reel/abc',
    'https://instagram.com/',
    '@nome com espaço',
    '@' + 'a'.repeat(31),
    'loja-com-hifen',
    'javascript:alert(1)',
  ])('recusa %s', (entrada) => {
    expect(normalizarInstagram(entrada).ok).toBe(false)
  })

  it('arroba para mostrar', () => {
    expect(arrobaDoInstagram('https://instagram.com/menuzia')).toBe('@menuzia')
    expect(arrobaDoInstagram(null)).toBeNull()
  })
})
