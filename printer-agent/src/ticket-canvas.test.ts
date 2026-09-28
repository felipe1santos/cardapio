import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TicketMenuzia from './ticket-canvas.js'

const RAIZ = join(__dirname, '..', '..')

describe('ticket-canvas — o mesmo desenho no Beta e na pré-visualização do painel', () => {
  it('as fontes e a logo da pré-visualização (public/impressao) são cópias exatas das do Assistente', () => {
    for (const f of TicketMenuzia.RECURSOS.fontes) {
      expect(readFileSync(join(RAIZ, 'public', 'impressao', 'fonts', f.arquivo)).equals(readFileSync(join(__dirname, 'fonts', f.arquivo))), f.arquivo).toBe(true)
    }
    expect(readFileSync(join(RAIZ, 'public', 'impressao', TicketMenuzia.RECURSOS.logo)).equals(readFileSync(join(__dirname, TicketMenuzia.RECURSOS.logo)))).toBe(true)
  })

  it('a logo embutida do Beta (renderer/logo-dados.js) é a mesma logo-menuzia.png', () => {
    const js = readFileSync(join(__dirname, 'renderer', 'logo-dados.js'), 'utf8')
    const b64 = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(js)?.[1] ?? ''
    expect(Buffer.from(b64, 'base64').equals(readFileSync(join(__dirname, 'logo-menuzia.png')))).toBe(true)
  })

  it('três tamanhos de letra: grande = modelo, média e pequena menores', () => {
    expect(TicketMenuzia.ESCALA_FONTE).toEqual({ grande: 1, media: 0.92, pequena: 0.85 })
  })

  it('largura em pontos: 80 mm = 576, 58 mm = 384, calibrada vale quando está na faixa', () => {
    expect(TicketMenuzia.larguraEmPontos(80, null)).toBe(576)
    expect(TicketMenuzia.larguraEmPontos(58, null)).toBe(384)
    expect(TicketMenuzia.larguraEmPontos(80, 512)).toBe(512)
  })
})
