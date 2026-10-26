import { describe, expect, it } from 'vitest'
import { caiuParaPainel, decidirMonitor, THROTTLE_MS } from './whatsapp-monitor'

/** Etapa 3 (20/10): alerta só quando a conexão cai sozinha; desconexão pelo painel fica em silêncio; não repete em 6 h. */
const agora = Date.parse('2026-10-20T01:00:00Z')
const iso = (min: number) => new Date(agora - min * 60_000).toISOString()

describe('monitor do WhatsApp: decisão', () => {
  it('caiu sozinho pela primeira vez → alerta e marca a hora da queda', () => {
    const d = decidirMonitor({ anterior: 'open', novo: 'close', caiuEm: null, manualEm: null, alertadoEm: null, agora })
    expect(d).toMatchObject({ estado: 'close', alertar: true, voltou: false, manual: false })
    expect(d.caiuEm).toBe(new Date(agora).toISOString())
  })
  it('continua caído e já alertou há 1 h → não repete o alerta; mantém a hora original da queda', () => {
    const d = decidirMonitor({ anterior: 'close', novo: 'close', caiuEm: iso(90), manualEm: null, alertadoEm: iso(60), agora })
    expect(d.alertar).toBe(false)
    expect(d.caiuEm).toBe(iso(90))
  })
  it('alertou há 7 h e segue caído → alerta de novo', () => {
    expect(decidirMonitor({ anterior: 'close', novo: 'close', caiuEm: iso(420), manualEm: null, alertadoEm: iso(420), agora }).alertar).toBe(true)
  })
  it('o dono desconectou pelo painel há 5 min → sem alerta (manual)', () => {
    const d = decidirMonitor({ anterior: 'open', novo: 'close', caiuEm: null, manualEm: iso(5), alertadoEm: null, agora })
    expect(d).toMatchObject({ alertar: false, manual: true })
  })
  it('desconexão manual antiga (2 h) não blinda uma queda nova', () => {
    expect(decidirMonitor({ anterior: 'open', novo: 'close', caiuEm: null, manualEm: iso(120), alertadoEm: null, agora }).alertar).toBe(true)
  })
  it('voltou (open depois de caído) → limpa a queda e marca "voltou" para reenviar avisos', () => {
    const d = decidirMonitor({ anterior: 'close', novo: 'open', caiuEm: iso(10), manualEm: null, alertadoEm: iso(10), agora })
    expect(d).toMatchObject({ estado: 'open', caiuEm: null, alertar: false, voltou: true })
  })
  it('Evolution sem resposta (null) com estado anterior desconhecido → trata como close, sem reabrir nada', () => {
    expect(decidirMonitor({ anterior: null, novo: null, caiuEm: null, manualEm: null, alertadoEm: null, agora }).estado).toBe('close')
  })
  it('throttle de 2 min por loja', () => { expect(THROTTLE_MS).toBe(120_000) })
})

/**
 * Achado #14 da auditoria (25/10): "connecting" era tratado como queda — uma reconexão curta da Evolution acendia faixa
 * vermelha, push e alerta grave. Agora "conectando" tem 3 min de tolerância; depois disso, é queda como as outras.
 */
describe('monitor do WhatsApp: "conectando"', () => {
  it('acabou de entrar em conectando → marca a hora, mas não alerta', () => {
    const d = decidirMonitor({ anterior: 'open', novo: 'connecting', caiuEm: null, manualEm: null, alertadoEm: null, agora })
    expect(d).toMatchObject({ estado: 'connecting', alertar: false })
    expect(d.caiuEm).toBe(new Date(agora).toISOString())
  })
  it('conectando há 2 min → ainda não alerta', () => {
    expect(decidirMonitor({ anterior: 'connecting', novo: 'connecting', caiuEm: iso(2), manualEm: null, alertadoEm: null, agora }).alertar).toBe(false)
  })
  it('conectando há 4 min → é queda: alerta', () => {
    expect(decidirMonitor({ anterior: 'connecting', novo: 'connecting', caiuEm: iso(4), manualEm: null, alertadoEm: null, agora }).alertar).toBe(true)
  })
  it('faixa vermelha: some em conectando recente, aparece em conectando longo e em close', () => {
    expect(caiuParaPainel('connecting', iso(1), agora)).toBe(false)
    expect(caiuParaPainel('connecting', iso(5), agora)).toBe(true)
    expect(caiuParaPainel('close', iso(0), agora)).toBe(true)
    expect(caiuParaPainel('open', null, agora)).toBe(false)
  })
})
