import { describe, expect, it } from 'vitest'
import { alertaImprimirSozinhoDesligado, alertaSemAssistente } from './alertas-painel'

const AGORA = Date.parse('2026-10-09T23:00:00Z')
const ha = (s: number) => new Date(AGORA - s * 1000).toISOString()

describe('alerta "A impressão automática está desligada"', () => {
  it('desligado, loja aberta e pedido chegando → alerta', () => {
    expect(alertaImprimirSozinhoDesligado({ impressaoAutomatica: false, lojaAberta: true, pedidosRecentes: 2 })).toBe(true)
  })
  it('ligado, loja fechada ou sem pedido → sem alerta', () => {
    expect(alertaImprimirSozinhoDesligado({ impressaoAutomatica: true, lojaAberta: true, pedidosRecentes: 2 })).toBe(false)
    expect(alertaImprimirSozinhoDesligado({ impressaoAutomatica: false, lojaAberta: false, pedidosRecentes: 2 })).toBe(false)
    expect(alertaImprimirSozinhoDesligado({ impressaoAutomatica: false, lojaAberta: true, pedidosRecentes: 0 })).toBe(false)
  })
})

describe('alerta vermelho: nenhum Assistente buscando pedidos', () => {
  const base = { impressaoAutomatica: true, lojaAberta: true, agora: AGORA }
  it('todos sem sinal há mais de 2 min → alerta', () => { expect(alertaSemAssistente({ ...base, sinais: [ha(180), null] })).toBe(true) })
  it('algum com sinal recente → sem alerta', () => { expect(alertaSemAssistente({ ...base, sinais: [ha(180), ha(30)] })).toBe(false) })
  it('loja sem Assistente, fechada ou com Imprimir sozinho desligado → sem alerta', () => {
    expect(alertaSemAssistente({ ...base, sinais: [] })).toBe(false)
    expect(alertaSemAssistente({ ...base, lojaAberta: false, sinais: [ha(600)] })).toBe(false)
    expect(alertaSemAssistente({ ...base, impressaoAutomatica: false, sinais: [ha(600)] })).toBe(false)
  })
})
