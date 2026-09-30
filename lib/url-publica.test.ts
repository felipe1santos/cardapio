import { describe, it, expect, afterEach } from 'vitest'
import { urlPublica } from './url-publica'

describe('urlPublica (B15)', () => {
  const antes = process.env.MENUZIA_URL_PUBLICA
  afterEach(() => { if (antes === undefined) delete process.env.MENUZIA_URL_PUBLICA; else process.env.MENUZIA_URL_PUBLICA = antes })
  it('padrão é o domínio de produção', () => {
    delete process.env.MENUZIA_URL_PUBLICA
    expect(urlPublica()).toBe('https://app.menuzia.com.br')
  })
  it('vem do ambiente, sem barra no fim', () => {
    process.env.MENUZIA_URL_PUBLICA = 'http://127.0.0.1:3999/'
    expect(urlPublica()).toBe('http://127.0.0.1:3999')
  })
})
