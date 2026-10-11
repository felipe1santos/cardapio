import { describe, expect, it } from 'vitest'
import { linksParaDivulgar } from './links-divulgar'
import { canalDaOrigem, capturarOrigem } from './origem-visita'

describe('Links para divulgar', () => {
  const links = linksParaDivulgar('https://app.menuzia.com.br/loja/menuzia/')
  it('endereço normal do cardápio + etiqueta (sem encurtador)', () => {
    for (const l of links) expect(l.url.startsWith('https://app.menuzia.com.br/loja/menuzia?utm_source=')).toBe(true)
  })
  it('Google: 3 links com utm_source=google, utm_medium=perfil e utm_content diferente', () => {
    const g = links.filter((l) => l.canal === 'google')
    expect(g).toHaveLength(3)
    const conteudos = g.map((l) => new URL(l.url).searchParams.get('utm_content'))
    expect(new Set(conteudos).size).toBe(3)
    for (const l of g) {
      const q = new URL(l.url).searchParams
      expect(q.get('utm_source')).toBe('google')
      expect(q.get('utm_medium')).toBe('perfil')
    }
  })
  it('cada link cai no canal certo quando o cliente abre', () => {
    const esperado: Record<string, string> = { google: 'google_busca', instagram: 'instagram', whatsapp: 'whatsapp', qrcode: 'qrcode' }
    for (const l of links) {
      const o = capturarOrigem({ busca: new URL(l.url).search, referrer: '', hostAtual: 'app.menuzia.com.br' })
      expect(canalDaOrigem(o), l.id).toBe(esperado[l.canal])
    }
  })
})
