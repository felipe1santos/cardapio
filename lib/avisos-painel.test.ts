import { describe, expect, it } from 'vitest'
import { mostrarAvisoNovaImpressao } from './avisos-painel'

describe('aviso do novo sistema de impressão', () => {
  it('aparece em todas as telas do painel, menos no Kanban e na própria Impressão', () => {
    for (const r of ['/admin', '/admin/dashboard', '/admin/cardapio', '/admin/ajustes', '/admin/logistica', '/admin/pdv', '/admin/mesas', '/admin/pedidosx']) {
      expect(mostrarAvisoNovaImpressao(r, true), r).toBe(true)
    }
    for (const r of ['/admin/pedidos', '/admin/pedidos/123', '/admin/impressao', '/admin/impressao/qualquer']) {
      expect(mostrarAvisoNovaImpressao(r, true), r).toBe(false)
    }
  })

  it('desligado pela flag: some de todas as telas', () => {
    expect(mostrarAvisoNovaImpressao('/admin/dashboard', false)).toBe(false)
  })
})
