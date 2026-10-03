import { describe, expect, it } from 'vitest'
import { categoriaNavegador, ehRobo } from './navegador'

const UA = {
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 341.0.0.36.98 (iPhone14,5; iOS 17_5; pt_BR)',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.81 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/484.0.0.53.104;]',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
}

describe('categoriaNavegador', () => {
  it('reconhece os navegadores internos e os comuns', () => {
    expect(categoriaNavegador(UA.instagram)).toEqual({ navegador: 'instagram', sistema: 'ios' })
    expect(categoriaNavegador(UA.facebookAndroid)).toEqual({ navegador: 'facebook', sistema: 'android' })
    expect(categoriaNavegador(UA.chromeAndroid)).toEqual({ navegador: 'chrome', sistema: 'android' })
    expect(categoriaNavegador(UA.safariIos)).toEqual({ navegador: 'safari', sistema: 'ios' })
    expect(categoriaNavegador(null)).toEqual({ navegador: 'outro', sistema: 'outro' })
  })
})

describe('ehRobo', () => {
  it('robôs e pré-visualizações de link', () => {
    expect(ehRobo('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true)
    expect(ehRobo('WhatsApp/2.23.20.0')).toBe(true)
    expect(ehRobo('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
    expect(ehRobo('')).toBe(true)
  })
  it('gente de verdade, inclusive no navegador do Instagram/Facebook', () => {
    for (const ua of Object.values(UA)) expect(ehRobo(ua)).toBe(false)
  })
})
