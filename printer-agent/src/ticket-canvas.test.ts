import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import TicketMenuzia from './ticket-canvas.js'

const RAIZ = join(__dirname, '..', '..')

describe('ticket-canvas — o mesmo desenho no Beta e na pré-visualização do painel', () => {
  it('as fontes da pré-visualização (public/impressao/fonts) são cópias exatas das do Assistente', () => {
    for (const f of TicketMenuzia.RECURSOS.fontes) {
      expect(readFileSync(join(RAIZ, 'public', 'impressao', 'fonts', f.arquivo)).equals(readFileSync(join(__dirname, 'fonts', f.arquivo))), f.arquivo).toBe(true)
    }
  })

  it('o renderizador do Beta não carrega mais logo fixa: a do topo é a da loja', () => {
    const html = readFileSync(join(__dirname, 'renderer', 'ticket.html'), 'utf8')
    expect(html).not.toContain('logo-dados.js')
    expect(html).toContain('carregarImagem')
  })

  it('três tamanhos de letra: grande = modelo, média e pequena menores', () => {
    expect(TicketMenuzia.ESCALA_FONTE).toEqual({ grande: 1, media: 0.92, pequena: 0.85 })
  })

  it('ícone da forma de pagamento: Pix, cartão, dinheiro, vale e celular; o resto sem ícone', () => {
    expect(TicketMenuzia.ICONE_DA_FORMA).toMatchObject({ pix: 'pix', cartao: 'cartao', credito: 'cartao', debito: 'cartao', dinheiro: 'dinheiro', vale: 'vale', online: 'celular' })
    expect(TicketMenuzia.ICONE_DA_FORMA.fiado).toBeUndefined()
  })

  it('largura em pontos: 80 mm = 576, 58 mm = 384, calibrada vale quando está na faixa', () => {
    expect(TicketMenuzia.larguraEmPontos(80, null)).toBe(576)
    expect(TicketMenuzia.larguraEmPontos(58, null)).toBe(384)
    expect(TicketMenuzia.larguraEmPontos(80, 512)).toBe(512)
  })
})
