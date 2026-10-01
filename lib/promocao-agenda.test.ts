import { describe, expect, it } from 'vitest'
import { promocaoVigente, resumoAgenda, temAgenda } from './promocao-agenda'

// 2026-10-02 é sexta-feira. 15:00Z = 12:00 em São Paulo.
const sp = (iso: string) => new Date(`${iso}-03:00`)

describe('agenda da promoção', () => {
  it('sem agenda vale sempre', () => {
    expect(temAgenda({})).toBe(false)
    expect(promocaoVigente({}, sp('2026-10-02T03:00'))).toBe(true)
    expect(promocaoVigente({ promocaoDias: [], promocaoHoraInicio: null }, sp('2026-10-02T03:00'))).toBe(true)
  })
  it('datas inclusive', () => {
    const a = { promocaoInicio: '2026-10-02', promocaoFim: '2026-10-05' }
    expect(promocaoVigente(a, sp('2026-10-01T23:59'))).toBe(false)
    expect(promocaoVigente(a, sp('2026-10-02T00:00'))).toBe(true)
    expect(promocaoVigente(a, sp('2026-10-05T23:59'))).toBe(true)
    expect(promocaoVigente(a, sp('2026-10-06T00:00'))).toBe(false)
  })
  it('dias da semana no horário de São Paulo', () => {
    const a = { promocaoDias: [5, 6] } // sex, sáb
    expect(promocaoVigente(a, sp('2026-10-02T12:00'))).toBe(true) // sexta
    expect(promocaoVigente(a, sp('2026-10-04T12:00'))).toBe(false) // domingo
    // 01:00Z de sábado ainda é sexta 22:00 em SP.
    expect(promocaoVigente({ promocaoDias: [5] }, new Date('2026-10-03T01:00:00Z'))).toBe(true)
  })
  it('faixa de horário', () => {
    const a = { promocaoHoraInicio: '18:00', promocaoHoraFim: '23:00' }
    expect(promocaoVigente(a, sp('2026-10-02T17:59'))).toBe(false)
    expect(promocaoVigente(a, sp('2026-10-02T18:00'))).toBe(true)
    expect(promocaoVigente(a, sp('2026-10-02T23:00'))).toBe(false)
  })
  it('faixa que passa da meia-noite conta no dia em que começou', () => {
    const a = { promocaoDias: [5], promocaoHoraInicio: '20:00', promocaoHoraFim: '02:00' }
    expect(promocaoVigente(a, sp('2026-10-02T21:00'))).toBe(true) // sexta 21h
    expect(promocaoVigente(a, sp('2026-10-03T01:30'))).toBe(true) // madrugada de sábado = sexta
    expect(promocaoVigente(a, sp('2026-10-03T02:30'))).toBe(false)
    expect(promocaoVigente(a, sp('2026-10-03T21:00'))).toBe(false) // sábado 21h
  })
  it('resumo', () => {
    expect(resumoAgenda({})).toBe('Sempre')
    expect(resumoAgenda({ promocaoDias: [6, 5], promocaoHoraInicio: '18:00:00', promocaoHoraFim: '23:00:00', promocaoFim: '2026-10-31' })).toBe('Sex, Sáb, 18:00–23:00, até 31/10')
  })
})
