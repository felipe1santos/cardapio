import { describe, expect, it } from 'vitest'
import { validarGoogleTag, validarPixelFacebook } from './pixels'

describe('IDs de medição', () => {
  it('Facebook Pixel: só números, 15–16 dígitos, espaços tirados', () => {
    expect(validarPixelFacebook('1234567890123456')).toEqual({ ok: true, valor: '1234567890123456' })
    expect(validarPixelFacebook(' 123456789012345 ')).toEqual({ ok: true, valor: '123456789012345' })
    expect(validarPixelFacebook('1234 5678 9012 345')).toEqual({ ok: true, valor: '123456789012345' })
    expect(validarPixelFacebook('125265262').ok).toBe(false)
    expect(validarPixelFacebook('12345678901234567').ok).toBe(false)
    expect(validarPixelFacebook('12345678901234a').ok).toBe(false)
    expect(validarPixelFacebook('').ok).toBe(false)
  })

  it('Google Tag: G-… ou GTM-…, maiúsculas e sem espaços', () => {
    expect(validarGoogleTag('g-abc123xyz9')).toEqual({ ok: true, valor: 'G-ABC123XYZ9' })
    expect(validarGoogleTag(' GTM-5K2XQ7L ')).toEqual({ ok: true, valor: 'GTM-5K2XQ7L' })
    expect(validarGoogleTag('gtm - 5k2xq7l')).toEqual({ ok: true, valor: 'GTM-5K2XQ7L' })
    expect(validarGoogleTag('UA-12345-1').ok).toBe(false)
    expect(validarGoogleTag('G-').ok).toBe(false)
    expect(validarGoogleTag('ABC').ok).toBe(false)
  })
})
