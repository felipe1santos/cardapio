import { describe, expect, it } from 'vitest'
import { compararVersao, mostrarAvisoNovaImpressao, precisaAtualizarAssistente } from './avisos-painel'

describe('aviso do novo sistema de impressão', () => {
  it('aparece em todas as telas do painel, menos no Kanban e na própria Impressão', () => {
    for (const r of ['/admin', '/admin/dashboard', '/admin/cardapio', '/admin/ajustes', '/admin/logistica', '/admin/lista-pedidos', '/admin/pdv', '/admin/mesas', '/admin/pedidosx']) {
      expect(mostrarAvisoNovaImpressao(r, true), r).toBe(true)
    }
    for (const r of ['/admin/pedidos', '/admin/pedidos/123', '/admin/impressao', '/admin/impressao/qualquer']) {
      expect(mostrarAvisoNovaImpressao(r, true), r).toBe(false)
    }
  })

  it('desligado pela flag: some de todas as telas', () => {
    expect(mostrarAvisoNovaImpressao('/admin/dashboard', false)).toBe(false)
  })

  it('compara versões do Assistente (beta antes da final)', () => {
    expect(compararVersao('0.2.0-beta.8', '0.2.0-beta.9')).toBeLessThan(0)
    expect(compararVersao('0.2.0-beta.10', '0.2.0-beta.9')).toBeGreaterThan(0)
    expect(compararVersao('0.2.0-beta.9', '0.2.0-beta.9')).toBe(0)
    expect(compararVersao('0.1.26', '0.2.0-beta.9')).toBeLessThan(0)
    expect(compararVersao('0.2.0', '0.2.0-beta.9')).toBeGreaterThan(0)
    expect(compararVersao(null, '0.2.0-beta.9')).toBeLessThan(0)
  })

  it('só pede atualização para quem imprime e não tem o Assistente do v3', () => {
    expect(precisaAtualizarAssistente(false, [])).toBe(false)
    expect(precisaAtualizarAssistente(true, [])).toBe(true) // só o Assistente antigo
    expect(precisaAtualizarAssistente(true, [{ versao: '0.2.0-beta.8' }])).toBe(true)
    expect(precisaAtualizarAssistente(true, [{ versao: '0.2.0-beta.8' }, { versao: '0.2.0-beta.9' }])).toBe(false)
    expect(precisaAtualizarAssistente(true, [{ versao: '0.2.0-beta.9', revogado: true }])).toBe(true)
  })
})
