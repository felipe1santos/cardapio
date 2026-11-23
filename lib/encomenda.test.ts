import { describe, expect, it } from 'vitest'
import {
  avisoSacolaMista,
  colunasEncomenda,
  encomendaDoItem,
  itemEncomendaDaLinha,
  configAgendamentoEncomenda,
  lembreteDevido,
  motivoEncomendaInvalida,
  regraEncomenda,
  textoPrazoEncomenda,
  tipoDaSacola,
} from './encomenda'
import { AGENDAMENTO_PADRAO, instanteDoHorario, pedidoLiberado } from './agendamento'

const H = 3600_000
const AGORA = new Date('2026-11-23T13:00:00.000Z') // 10:00 em São Paulo

const bolo = { encomenda: true, prazoHoras: 48, pagamentoAntecipado: false }
const pudim = { encomenda: true, prazoHoras: 24, pagamentoAntecipado: true }
const brigadeiro = { encomenda: false, prazoHoras: 24, pagamentoAntecipado: false }

describe('tipoDaSacola', () => {
  it('classifica vazia, normal, encomenda e mista', () => {
    expect(tipoDaSacola([])).toBe('vazia')
    expect(tipoDaSacola([brigadeiro])).toBe('normal')
    expect(tipoDaSacola([bolo, pudim])).toBe('encomenda')
    expect(tipoDaSacola([bolo, brigadeiro])).toBe('mista')
  })
})

describe('avisoSacolaMista', () => {
  it('cita o item de encomenda e pede pedidos separados', () => {
    expect(avisoSacolaMista(['Bolo de Pote'])).toMatch(/^"Bolo de Pote" é feito por encomenda\./)
    expect(avisoSacolaMista(['Bolo', 'Pudim'])).toMatch(/^"Bolo" e "Pudim" são feitos por encomenda\./)
    expect(avisoSacolaMista(['A', 'B', 'C'])).toMatch(/^3 itens são feitos por encomenda\./)
    expect(avisoSacolaMista(['Bolo'])).toMatch(/pedidos separados/)
  })
})

describe('regraEncomenda', () => {
  it('maior prazo e pagamento antecipado se algum pedir', () => {
    expect(regraEncomenda([bolo, pudim])).toEqual({ prazoHoras: 48, pagamentoAntecipado: true })
  })
  it('ignora itens que não são encomenda; sem encomenda = null', () => {
    expect(regraEncomenda([brigadeiro])).toBeNull()
  })
})

describe('pedidoLiberado com liberar_em (0250)', () => {
  it('liberar_em passado libera mesmo longe do horário', () => {
    expect(pedidoLiberado('2026-11-25T18:00:00.000Z', 30, AGORA, '2026-11-23T12:00:00.000Z')).toBe(true)
  })
  it('liberar_em futuro: vale a regra da loja', () => {
    expect(pedidoLiberado('2026-11-25T18:00:00.000Z', 30, AGORA, '2026-11-24T18:00:00.000Z')).toBe(false)
    expect(pedidoLiberado('2026-11-23T13:20:00.000Z', 30, AGORA, '2026-11-24T18:00:00.000Z')).toBe(true)
  })
  it('sem liberar_em: igual à 0121', () => {
    expect(pedidoLiberado('2026-11-25T18:00:00.000Z', 30, AGORA, null)).toBe(false)
    expect(pedidoLiberado(null, 30, AGORA)).toBe(true)
  })
})

describe('motivoEncomendaInvalida', () => {
  const regra = { prazoHoras: 48, pagamentoAntecipado: false }
  it('exige data', () => {
    expect(motivoEncomendaInvalida(regra, null, false, AGORA)).toMatch(/data/)
  })
  it('recusa antes do prazo e aceita depois', () => {
    expect(motivoEncomendaInvalida(regra, new Date(AGORA.getTime() + 47 * H).toISOString(), false, AGORA)).toMatch(/48 h|2 dias/)
    expect(motivoEncomendaInvalida(regra, new Date(AGORA.getTime() + 48 * H).toISOString(), false, AGORA)).toBeNull()
  })
  it('pagamento antecipado exige pagamento online', () => {
    const r = { ...regra, pagamentoAntecipado: true }
    const quando = new Date(AGORA.getTime() + 72 * H).toISOString()
    expect(motivoEncomendaInvalida(r, quando, false, AGORA)).toMatch(/paga antecipado/)
    expect(motivoEncomendaInvalida(r, quando, true, AGORA)).toBeNull()
  })
})

describe('configAgendamentoEncomenda', () => {
  it('sempre ativa, antecedência = prazo, sem limite por horário, entrega e retirada; janela cobre o prazo', () => {
    const c = configAgendamentoEncomenda({ ...AGENDAMENTO_PADRAO, ativo: false, entrega: false, limite: 3, intervaloMin: 15 }, 72)
    expect(c).toMatchObject({ ativo: true, quando: 'sempre', antecedenciaMin: 72 * 60, limite: null, entrega: true, retirada: true, intervaloMin: 15 })
    expect(c.dias).toBeGreaterThanOrEqual(3 + 14)
    expect(c.dias).toBeLessThanOrEqual(45)
  })
})

describe('textoPrazoEncomenda', () => {
  it('horas até 47, dias a partir de 48 (inteiros)', () => {
    expect(textoPrazoEncomenda(6)).toBe('6 h')
    expect(textoPrazoEncomenda(24)).toBe('24 h')
    expect(textoPrazoEncomenda(48)).toBe('2 dias')
    expect(textoPrazoEncomenda(50)).toBe('50 h')
  })
})

describe('lembreteDevido (véspera)', () => {
  const ag = instanteDoHorario('2026-11-24', '15:00') // amanhã 15h SP = 18:00Z
  it('sai dentro das 24 h antes, se o pedido foi feito com folga', () => {
    expect(lembreteDevido(ag, "2026-11-20T12:00:00.000Z", new Date(Date.parse(ag) - 20 * H))).toBe(true)
  })
  it('não sai faltando menos de 1 h, nem com mais de 24 h, nem pedido feito em cima da hora', () => {
    expect(lembreteDevido(ag, '2026-11-20T12:00:00.000Z', new Date(Date.parse(ag) - 30 * 60_000))).toBe(false)
    expect(lembreteDevido(ag, '2026-11-20T12:00:00.000Z', new Date(Date.parse(ag) - 25 * H))).toBe(false)
    expect(lembreteDevido(ag, new Date(Date.parse(ag) - 10 * H).toISOString(), new Date(Date.parse(ag) - 5 * H))).toBe(false)
  })
})

describe('itemEncomendaDaLinha', () => {
  it('linha do banco → regra; ausente = item comum', () => {
    expect(itemEncomendaDaLinha({ encomenda: true, encomenda_prazo_horas: 48, encomenda_pagamento_antecipado: true }))
      .toEqual({ encomenda: true, prazoHoras: 48, pagamentoAntecipado: true })
    expect(itemEncomendaDaLinha(undefined)).toEqual({ encomenda: false, prazoHoras: 24, pagamentoAntecipado: false })
  })
})

describe('encomendaDoItem / colunasEncomenda', () => {
  it('ida e volta; desligado = null', () => {
    const cols = colunasEncomenda({ prazoHoras: 48, pagamentoAntecipado: true })
    expect(encomendaDoItem(cols)).toEqual({ prazoHoras: 48, pagamentoAntecipado: true })
    expect(encomendaDoItem(colunasEncomenda(null))).toBeNull()
  })
  it('prende os números nos limites do banco', () => {
    expect(colunasEncomenda({ prazoHoras: 9999, pagamentoAntecipado: false })).toMatchObject({ encomenda_prazo_horas: 720 })
  })
})

describe('lembreteDevido — encomenda de prazo 24 h (revisão)', () => {
  it('pedido feito 24 h antes não ganha lembrete logo depois de criado', () => {
    const ag = '2026-11-24T18:00:00.000Z'
    const criado = new Date(Date.parse(ag) - 24 * H - 5 * 60_000).toISOString()
    expect(lembreteDevido(ag, criado, new Date(Date.parse(ag) - 24 * H + 5 * 60_000))).toBe(false)
  })
  it('pedido feito 2 dias antes ganha', () => {
    const ag = '2026-11-24T18:00:00.000Z'
    expect(lembreteDevido(ag, new Date(Date.parse(ag) - 48 * H).toISOString(), new Date(Date.parse(ag) - 23 * H))).toBe(true)
  })
})
