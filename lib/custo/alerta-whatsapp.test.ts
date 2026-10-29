import { describe, expect, it } from 'vitest'
import { avisarSuporte, nivelDoAssunto } from './alerta-whatsapp'

/**
 * 28/10: o alerta da guarda (loop, limite, teto da IA) só ia pelo WhatsApp da Menuzia, desconectado desde 23/10. Agora a
 * guarda só GRAVA (pendente) e o cron do servidor envia (lib/saude/vigia.ts › despacharPendentes) — a guarda também roda
 * no navegador (frete), que não pode importar o envio (web-push).
 */
function bancoFalso() {
  const inseridos: Record<string, unknown>[] = []
  const admin = { from: () => ({ insert: async (v: Record<string, unknown>) => { inseridos.push(v); return { error: null } } }) }
  return { admin: admin as never, inseridos }
}

describe('alerta de custo da guarda', () => {
  it('grava pendente no histórico da Saúde do sistema (o cron envia)', async () => {
    const b = bancoFalso()
    await avisarSuporte(b.admin, 'geocoding:disparo', 'A mesma chamada passou de 20 vezes', 60_000, true)
    expect(b.inseridos[0]).toMatchObject({ assunto: 'custo:geocoding:disparo', nivel: 'vermelho', canal: null, enviado: false })
    expect(String(b.inseridos[0].texto)).toMatch(/20 vezes/)
  })
  it('o mesmo assunto não repete dentro da janela', async () => {
    const b = bancoFalso()
    await avisarSuporte(b.admin, 'uber:atencao', 'x', 60_000, true)
    await avisarSuporte(b.admin, 'uber:atencao', 'x', 60_000, true)
    expect(b.inseridos).toHaveLength(1)
  })
  it('nível: laço, bloqueio e teto = vermelho; 80% = amarelo', () => {
    expect(nivelDoAssunto('geocoding:disparo')).toBe('vermelho')
    expect(nivelDoAssunto('directions:bloqueio')).toBe('vermelho')
    expect(nivelDoAssunto('ia:teto:sistema:2026-10-28')).toBe('vermelho')
    expect(nivelDoAssunto('geocoding:atencao')).toBe('amarelo')
  })
})
