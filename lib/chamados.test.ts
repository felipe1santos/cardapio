import { describe, it, expect } from 'vitest'
import { ehMotivo, esperaTexto, esperaCritica, MOTIVOS_CHAMADO, ROTULO_MOTIVO } from './chamados'

const AGORA = new Date('2026-09-18T12:00:00Z').getTime()
const atras = (ms: number) => new Date(AGORA - ms).toISOString()

describe('motivos de chamado', () => {
  it('aceita só os três motivos do CHECK do banco', () => {
    for (const m of ['garcom', 'conta', 'ajuda']) expect(ehMotivo(m)).toBe(true)
    for (const m of ['GARCOM', 'pagar', '', null, undefined, 1, {}]) expect(ehMotivo(m)).toBe(false)
  })

  it('todo motivo oferecido na tela tem rótulo — nada aparece sem nome', () => {
    for (const m of MOTIVOS_CHAMADO) {
      expect(ehMotivo(m.id)).toBe(true)
      expect(ROTULO_MOTIVO[m.id]).toBeTruthy()
      expect(m.rotulo).toBeTruthy()
      expect(m.descricao).toBeTruthy()
    }
    expect(MOTIVOS_CHAMADO).toHaveLength(Object.keys(ROTULO_MOTIVO).length)
  })
})

describe('espera', () => {
  it('abaixo de um minuto é "agora" — a etiqueta não pisca a cada segundo', () => {
    expect(esperaTexto(atras(0), AGORA)).toBe('agora')
    expect(esperaTexto(atras(59_000), AGORA)).toBe('agora')
  })

  it('conta minutos e depois horas', () => {
    expect(esperaTexto(atras(60_000), AGORA)).toBe('há 1 min')
    expect(esperaTexto(atras(7 * 60_000), AGORA)).toBe('há 7 min')
    expect(esperaTexto(atras(59 * 60_000), AGORA)).toBe('há 59 min')
    expect(esperaTexto(atras(60 * 60_000), AGORA)).toBe('há 1 h')
    expect(esperaTexto(atras(150 * 60_000), AGORA)).toBe('há 2 h')
  })

  it('data inválida não vira NaN na tela', () => {
    expect(esperaTexto('não é data', AGORA)).toBe('agora')
  })

  it('espera crítica só a partir do limite', () => {
    expect(esperaCritica(atras(4 * 60_000), AGORA)).toBe(false)
    expect(esperaCritica(atras(5 * 60_000), AGORA)).toBe(true)
    expect(esperaCritica(atras(2 * 60_000), AGORA, 1)).toBe(true)
  })
})
