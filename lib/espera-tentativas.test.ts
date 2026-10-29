import { describe, expect, it } from 'vitest'
import { deveConsultarCorrida, esperaEnvioCanal, MAX_TENTATIVAS_CANAL, proximaVerificacaoPix } from './espera-tentativas'

const MIN = 60_000
const H = 60 * MIN

describe('status para iFood/99/Open Delivery com erro (antes: todo minuto, sem limite)', () => {
  it('espera dobra a cada erro: 1, 2, 4, 8… até 60 min', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((t) => (esperaEnvioCanal(t) ?? 0) / MIN)).toEqual([1, 2, 4, 8, 16, 32, 60])
  })
  it(`depois de ${MAX_TENTATIVAS_CANAL} erros na mesma etapa, para de tentar`, () => {
    expect(esperaEnvioCanal(MAX_TENTATIVAS_CANAL)).toBeNull()
    expect(esperaEnvioCanal(MAX_TENTATIVAS_CANAL - 1)).not.toBeNull()
  })
})

describe('Pix com erro do Mercado Pago (antes: todo minuto, para sempre)', () => {
  const expira = Date.parse('2026-10-28T20:00:00Z')
  it('antes de vencer e na 1ª hora depois: a cada minuto', () => {
    expect(proximaVerificacaoPix(expira, expira - 10 * MIN)).toBe(expira - 9 * MIN)
    expect(proximaVerificacaoPix(expira, expira + 30 * MIN)).toBe(expira + 31 * MIN)
  })
  it('até 24 h: a cada 15 min; até 7 dias: a cada 2 h', () => {
    expect(proximaVerificacaoPix(expira, expira + 5 * H)).toBe(expira + 5 * H + 15 * MIN)
    expect(proximaVerificacaoPix(expira, expira + 3 * 24 * H)).toBe(expira + 3 * 24 * H + 2 * H)
  })
  it('passou de 7 dias: 1 vez por dia (nunca muda o status sozinho — dinheiro)', () => {
    const t = expira + 7 * 24 * H + 1
    expect(proximaVerificacaoPix(expira, t)).toBe(t + 24 * H)
  })
})

describe('corrida ativa consultada no parceiro (antes: ~1/min a corrida inteira)', () => {
  const criada = Date.parse('2026-10-28T20:00:00Z')
  const consulta = (idadeMin: number, ultimaMin: number) => deveConsultarCorrida(new Date(criada).toISOString(), new Date(criada + ultimaMin * MIN).toISOString(), null, criada + idadeMin * MIN)
  it('primeiros 30 min: a cada ~1 min', () => {
    expect(consulta(10, 9)).toBe(true)
    expect(consulta(10, 9.5)).toBe(false)
  })
  it('30–90 min: a cada 3 min; depois: a cada 10 min', () => {
    expect(consulta(60, 58)).toBe(false)
    expect(consulta(60, 57)).toBe(true)
    expect(consulta(120, 115)).toBe(false)
    expect(consulta(120, 110)).toBe(true)
  })
  it('conta a última CONSULTA (sem mudança) além da última novidade', () => {
    const t = criada + 120 * MIN
    expect(deveConsultarCorrida(new Date(criada).toISOString(), new Date(criada).toISOString(), new Date(t - 5 * MIN).toISOString(), t)).toBe(false)
  })
})
