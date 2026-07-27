import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  horaDentroDoIntervalo,
  lojaEstaAberta,
  proximaAbertura,
  turnosDoDia,
  type HorarioFuncionamento,
} from './timezone'

/**
 * Congela o relógio num instante de São Paulo. Passa o horário em UTC-3 e a função
 * converte — os helpers do módulo formatam sempre em America/Sao_Paulo.
 */
function congelarEmSaoPaulo(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${iso}-03:00`))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('horaDentroDoIntervalo', () => {
  it('trata intervalo normal como [inicio, fim)', () => {
    expect(horaDentroDoIntervalo('12:00', '11:00', '14:00')).toBe(true)
    expect(horaDentroDoIntervalo('11:00', '11:00', '14:00')).toBe(true)
    expect(horaDentroDoIntervalo('14:00', '11:00', '14:00')).toBe(false)
    expect(horaDentroDoIntervalo('10:59', '11:00', '14:00')).toBe(false)
  })

  it('trata intervalo que atravessa a meia-noite', () => {
    expect(horaDentroDoIntervalo('19:00', '18:00', '02:00')).toBe(true)
    expect(horaDentroDoIntervalo('23:59', '18:00', '02:00')).toBe(true)
    expect(horaDentroDoIntervalo('00:30', '18:00', '02:00')).toBe(true)
    expect(horaDentroDoIntervalo('02:00', '18:00', '02:00')).toBe(false)
    expect(horaDentroDoIntervalo('15:00', '18:00', '02:00')).toBe(false)
  })

  it('trata inicio igual a fim como 24 horas', () => {
    expect(horaDentroDoIntervalo('03:00', '00:00', '00:00')).toBe(true)
  })
})

describe('turnosDoDia', () => {
  it('lê o formato novo (lista de turnos)', () => {
    const grade = { '1': [{ abre: '11:00', fecha: '14:00' }, { abre: '18:00', fecha: '23:00' }] }
    expect(turnosDoDia(grade, 1)).toHaveLength(2)
  })

  it('lê o formato antigo (um objeto por dia) sem quebrar', () => {
    const antigo = { '1': { abre: '18:00', fecha: '23:00' } } as unknown as HorarioFuncionamento
    expect(turnosDoDia(antigo, 1)).toEqual([{ abre: '18:00', fecha: '23:00' }])
  })

  it('devolve lista vazia para dia fechado, dia ausente ou grade nula', () => {
    expect(turnosDoDia({ '1': null }, 1)).toEqual([])
    expect(turnosDoDia({ '1': [] }, 1)).toEqual([])
    expect(turnosDoDia({ '1': [{ abre: '11:00', fecha: '14:00' }] }, 3)).toEqual([])
    expect(turnosDoDia(null, 1)).toEqual([])
  })
})

describe('lojaEstaAberta', () => {
  const automatico = 'automatico' as const

  it('deixa aberta a loja que nunca configurou grade', () => {
    congelarEmSaoPaulo('2026-07-27T03:00:00')
    expect(lojaEstaAberta({ statusLoja: automatico, horarioFuncionamento: null })).toBe(true)
  })

  it('respeita o override manual sobre a grade', () => {
    congelarEmSaoPaulo('2026-07-27T03:00:00') // domingo de madrugada, grade fechada
    const grade: HorarioFuncionamento = { '0': [{ abre: '11:00', fecha: '14:00' }] }
    expect(lojaEstaAberta({ statusLoja: 'aberto_manual', horarioFuncionamento: grade })).toBe(true)
    expect(lojaEstaAberta({ statusLoja: 'fechado_manual', horarioFuncionamento: grade })).toBe(false)
  })

  it('abre e fecha entre dois turnos do mesmo dia', () => {
    // 2026-07-27 é uma segunda-feira.
    const grade: HorarioFuncionamento = {
      '1': [{ abre: '11:00', fecha: '14:00' }, { abre: '18:00', fecha: '23:00' }],
    }
    const loja = { statusLoja: automatico, horarioFuncionamento: grade }

    congelarEmSaoPaulo('2026-07-27T12:00:00')
    expect(lojaEstaAberta(loja)).toBe(true)

    congelarEmSaoPaulo('2026-07-27T16:00:00') // vão da tarde
    expect(lojaEstaAberta(loja)).toBe(false)

    congelarEmSaoPaulo('2026-07-27T19:00:00')
    expect(lojaEstaAberta(loja)).toBe(true)
  })

  it('mantém aberta depois da meia-noite no turno que vira o dia', () => {
    const grade: HorarioFuncionamento = { '1': [{ abre: '18:00', fecha: '02:00' }] }
    const loja = { statusLoja: automatico, horarioFuncionamento: grade }

    congelarEmSaoPaulo('2026-07-27T19:00:00') // segunda à noite
    expect(lojaEstaAberta(loja)).toBe(true)

    congelarEmSaoPaulo('2026-07-28T01:00:00') // terça de madrugada, turno de segunda
    expect(lojaEstaAberta(loja)).toBe(true)

    congelarEmSaoPaulo('2026-07-28T02:30:00') // turno já encerrou
    expect(lojaEstaAberta(loja)).toBe(false)
  })

  it('não abre de madrugada no dia em que o turno noturno ainda vai começar', () => {
    const grade: HorarioFuncionamento = { '1': [{ abre: '18:00', fecha: '02:00' }] }
    congelarEmSaoPaulo('2026-07-27T01:00:00') // segunda 01:00, domingo não tem turno
    expect(lojaEstaAberta({ statusLoja: automatico, horarioFuncionamento: grade })).toBe(false)
  })

  it('fecha em dia sem turno dentro de uma grade já configurada', () => {
    const grade: HorarioFuncionamento = { '1': [{ abre: '11:00', fecha: '14:00' }], '2': null }
    congelarEmSaoPaulo('2026-07-28T12:00:00') // terça
    expect(lojaEstaAberta({ statusLoja: automatico, horarioFuncionamento: grade })).toBe(false)
  })
})

describe('proximaAbertura', () => {
  it('acha o próximo turno ainda hoje', () => {
    congelarEmSaoPaulo('2026-07-27T16:00:00') // segunda, vão da tarde
    const grade: HorarioFuncionamento = {
      '1': [{ abre: '11:00', fecha: '14:00' }, { abre: '18:00', fecha: '23:00' }],
    }
    expect(proximaAbertura(grade)).toEqual({ diaSemana: 1, hora: '18:00' })
  })

  it('pula para o próximo dia quando os turnos de hoje já passaram', () => {
    congelarEmSaoPaulo('2026-07-27T23:30:00') // segunda, tudo encerrado
    const grade: HorarioFuncionamento = {
      '1': [{ abre: '18:00', fecha: '23:00' }],
      '2': [{ abre: '11:00', fecha: '14:00' }],
    }
    expect(proximaAbertura(grade)).toEqual({ diaSemana: 2, hora: '11:00' })
  })

  it('vira a semana até achar o próximo turno', () => {
    congelarEmSaoPaulo('2026-07-28T10:00:00') // terça
    const grade: HorarioFuncionamento = { '1': [{ abre: '18:00', fecha: '23:00' }] }
    expect(proximaAbertura(grade)).toEqual({ diaSemana: 1, hora: '18:00' })
  })

  it('devolve null quando não há turno nenhum', () => {
    congelarEmSaoPaulo('2026-07-27T10:00:00')
    expect(proximaAbertura({ '1': null })).toBeNull()
    expect(proximaAbertura(null)).toBeNull()
  })
})
