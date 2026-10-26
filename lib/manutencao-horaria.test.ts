import { describe, expect, it } from 'vitest'
import { criarPortaoHorario } from './manutencao-horaria'

/**
 * Revisão de escala (26/10): o cron do WhatsApp (a cada minuto) também rodava manutenção sem pressa — limpeza de
 * mensagens antigas (lê as tabelas inteiras), cashback vencido e perguntas não entendidas. Agora: uma vez por hora.
 */
describe('criarPortaoHorario', () => {
  it('libera na primeira vez e depois só passada 1 hora', () => {
    const portao = criarPortaoHorario(60 * 60_000)
    const t0 = Date.parse('2026-10-26T10:00:00Z')
    expect(portao.liberar(t0)).toBe(true)
    expect(portao.liberar(t0 + 59 * 60_000)).toBe(false)
    expect(portao.liberar(t0 + 60 * 60_000)).toBe(true)
    expect(portao.liberar(t0 + 61 * 60_000)).toBe(false)
  })
})
