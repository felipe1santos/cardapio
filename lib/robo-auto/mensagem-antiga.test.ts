import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mensagemAntiga, MENSAGEM_ANTIGA_MS } from './mensagem-antiga'

// 15/11/2026: a Evolution reconectou às 00:15 e o WhatsApp reentregou ~30 h de mensagens da Gordelícia;
// o robô e a IA responderam 162 mensagens velhas de 44 clientes de madrugada.
const AGORA = Date.parse('2026-11-15T03:30:00Z')
const ha = (min: number) => new Date(AGORA - min * 60_000).toISOString()

describe('mensagem antiga não ganha resposta do robô/IA', () => {
  it('limite de 10 minutos', () => {
    expect(MENSAGEM_ANTIGA_MS).toBe(10 * 60_000)
  })

  it('recente responde; velha (reentrega da Evolution) não', () => {
    expect(mensagemAntiga(ha(0), AGORA)).toBe(false)
    expect(mensagemAntiga(ha(9), AGORA)).toBe(false)
    expect(mensagemAntiga(ha(11), AGORA)).toBe(true)
    expect(mensagemAntiga(ha(30 * 60), AGORA)).toBe(true)
  })

  it('sem hora ou hora inválida conta como nova (não cala o robô por falta de dado)', () => {
    expect(mensagemAntiga(null, AGORA)).toBe(false)
    expect(mensagemAntiga('lixo', AGORA)).toBe(false)
  })

  it('relógio do celular adiantado (hora no futuro) conta como nova', () => {
    expect(mensagemAntiga(ha(-5), AGORA)).toBe(false)
  })

  it('o motor confere a idade antes de decidir a resposta (robô e IA)', () => {
    const src = readFileSync('lib/robo-auto/motor.ts', 'utf8')
    const checagem = src.indexOf('mensagemAntiga(m.instante')
    const decidirIdx = src.indexOf("if (e.acao !== 'decidir')")
    expect(checagem).toBeGreaterThan(0)
    expect(decidirIdx).toBeGreaterThan(0)
    expect(checagem).toBeLessThan(decidirIdx)
  })
})
