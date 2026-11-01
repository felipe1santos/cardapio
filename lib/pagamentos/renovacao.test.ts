import { describe, expect, it } from 'vitest'
import { contasParaRenovar, RENOVACAO_ESPERA_MS } from './renovacao'

/**
 * 01/11/2026 (Fase 5): a renovação do token do Mercado Pago rodava TODO MINUTO para toda conta a menos de 30 dias
 * do vencimento; se o MP recusasse, eram 1.440 tentativas por dia por até 30 dias (regra 1: espera + limite).
 * Agora: no máximo 1 tentativa por hora por conta (`atualizado_em` marca a última tentativa).
 */
const agora = Date.parse('2026-11-01T12:00:00Z')
const h = (n: number) => new Date(agora - n * 3600_000).toISOString()

describe('contasParaRenovar', () => {
  it('só contas conectadas a menos de 30 dias do vencimento e com a última tentativa há 1 h ou mais', () => {
    const contas = [
      { restaurante_id: 'vence-logo-tentou-agora', expira_em: h(-24 * 10), atualizado_em: h(0.5) },
      { restaurante_id: 'vence-logo-tentou-ha-2h', expira_em: h(-24 * 10), atualizado_em: h(2) },
      { restaurante_id: 'vence-logo-nunca-tentou', expira_em: h(-24 * 10), atualizado_em: null },
      { restaurante_id: 'vence-em-60-dias', expira_em: h(-24 * 60), atualizado_em: h(5) },
    ]
    expect(contasParaRenovar(contas, agora).map((c) => c.restaurante_id)).toEqual(['vence-logo-tentou-ha-2h', 'vence-logo-nunca-tentou'])
    expect(RENOVACAO_ESPERA_MS).toBe(3600_000)
  })
})
