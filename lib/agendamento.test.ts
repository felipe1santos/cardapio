import { describe, expect, it } from 'vitest'
import {
  AGENDAMENTO_PADRAO,
  configAgendamento,
  horariosAgendamento,
  instanteDoHorario,
  motivoAgendamentoInvalido,
  pedidoLiberado,
  podeAgendar,
  somenteAgendado,
  textoAbrimos,
  textoAgendado,
  validarConfigAgendamento,
  type ConfigAgendamento,
} from './agendamento'
import type { HorarioFuncionamento } from './timezone'

// Quinta-feira, 01/10/2026, 10:00 em São Paulo.
const AGORA = new Date('2026-10-01T13:00:00Z')
const ATIVO: ConfigAgendamento = { ...AGENDAMENTO_PADRAO, ativo: true, dias: 3, antecedenciaMin: 60, intervaloMin: 30 }
// Quinta 18:00–23:00; sexta 18:00–02:00 (vira a noite); sábado fechado.
const GRADE: HorarioFuncionamento = {
  '4': [{ abre: '18:00', fecha: '23:00' }],
  '5': [{ abre: '18:00', fecha: '02:00' }],
  '6': null,
}

describe('configAgendamento', () => {
  it('coluna ausente (antes da 0121) = desligado', () => {
    expect(configAgendamento({ id: 'x' })).toEqual(AGENDAMENTO_PADRAO)
    expect(configAgendamento(null).ativo).toBe(false)
  })
  it('lê as colunas', () => {
    const c = configAgendamento({ agendamento_ativo: true, agendamento_quando: 'sempre', agendamento_dias: 2, agendamento_antecedencia_min: 30, agendamento_intervalo_min: 15, agendamento_limite: 4, agendamento_entrega: false, agendamento_retirada: true, agendamento_libera_min: 20 })
    expect(c).toEqual({ ativo: true, quando: 'sempre', dias: 2, antecedenciaMin: 30, intervaloMin: 15, limite: 4, entrega: false, retirada: true, liberaMin: 20 })
  })
})

describe('validarConfigAgendamento', () => {
  it('aceita o padrão e recusa valores fora da faixa', () => {
    expect(validarConfigAgendamento(AGENDAMENTO_PADRAO)).toBeNull()
    expect(validarConfigAgendamento({ ...ATIVO, dias: 0 })).toMatch(/Dias/)
    expect(validarConfigAgendamento({ ...ATIVO, intervaloMin: 25 })).toMatch(/Intervalo/)
    expect(validarConfigAgendamento({ ...ATIVO, limite: 0 })).toMatch(/Limite/)
    expect(validarConfigAgendamento({ ...ATIVO, entrega: false, retirada: false })).toMatch(/entrega, retirada/)
  })
})

describe('horariosAgendamento', () => {
  const dias = horariosAgendamento(ATIVO, GRADE, AGORA)
  it('só dias com funcionamento, rotulados', () => {
    expect(dias.map((d) => d.rotulo)).toEqual(['Hoje', 'Amanhã', 'Sábado, 03/10'])
    expect(dias[0].data).toBe('2026-10-01')
  })
  it('de 30 em 30, dentro do turno (fim exclusivo)', () => {
    expect(dias[0].horarios[0]).toBe('18:00')
    expect(dias[0].horarios.at(-1)).toBe('22:30')
    expect(dias[0].horarios).toHaveLength(10)
  })
  it('turno que vira a noite: horários depois da meia-noite caem no dia seguinte', () => {
    expect(dias[1].horarios.at(-1)).toBe('23:30')
    const sabado = horariosAgendamento({ ...ATIVO, dias: 3 }, GRADE, AGORA)
    // Sábado fechado, mas tem a cauda da sexta (00:00–02:00).
    expect(sabado.find((d) => d.data === '2026-10-03')?.horarios).toEqual(['00:00', '00:30', '01:00', '01:30'])
  })
  it('respeita a antecedência mínima', () => {
    const tarde = new Date('2026-10-01T21:10:00Z') // 18:10 SP
    const h = horariosAgendamento(ATIVO, GRADE, tarde)[0].horarios
    expect(h[0]).toBe('19:30')
  })
  it('tira horário lotado', () => {
    const iso = instanteDoHorario('2026-10-01', '18:00')
    const h = horariosAgendamento({ ...ATIVO, limite: 2 }, GRADE, AGORA, new Map([[iso, 2]]))[0].horarios
    expect(h[0]).toBe('18:30')
  })
  it('sem grade = dia inteiro', () => {
    const h = horariosAgendamento({ ...ATIVO, dias: 1, intervaloMin: 60 }, null, AGORA)[0].horarios
    expect(h[0]).toBe('11:00')
    expect(h.at(-1)).toBe('23:00')
  })
})

describe('motivoAgendamentoInvalido (servidor)', () => {
  const ok = instanteDoHorario('2026-10-01', '19:30')
  it('horário válido passa', () => {
    expect(motivoAgendamentoInvalido(ATIVO, GRADE, ok, 'entrega', false, AGORA)).toBeNull()
  })
  it('desligado, canal desligado, fora da grade, fora do intervalo, passado', () => {
    expect(motivoAgendamentoInvalido({ ...ATIVO, ativo: false }, GRADE, ok, 'entrega', false, AGORA)).toMatch(/não está aceitando/)
    expect(motivoAgendamentoInvalido({ ...ATIVO, entrega: false }, GRADE, ok, 'entrega', false, AGORA)).toMatch(/entrega/)
    expect(motivoAgendamentoInvalido(ATIVO, GRADE, instanteDoHorario('2026-10-01', '15:00'), 'entrega', false, AGORA)).toMatch(/não está disponível/)
    expect(motivoAgendamentoInvalido(ATIVO, GRADE, instanteDoHorario('2026-10-01', '19:10'), 'entrega', false, AGORA)).toMatch(/não está disponível/)
    expect(motivoAgendamentoInvalido(ATIVO, GRADE, '2026-09-30T22:00:00Z', 'entrega', false, AGORA)).toMatch(/não está disponível/)
    expect(motivoAgendamentoInvalido(ATIVO, GRADE, 'lixo', 'entrega', false, AGORA)).toMatch(/inválido/)
  })
  it('lotado', () => {
    expect(motivoAgendamentoInvalido({ ...ATIVO, limite: 1 }, GRADE, ok, 'retirada', false, AGORA, new Map([[ok, 1]]))).toMatch(/lotou/)
  })
  it('loja aberta: só no modo "sempre"', () => {
    expect(motivoAgendamentoInvalido(ATIVO, GRADE, ok, 'entrega', true, AGORA)).toMatch(/não está aceitando/)
    expect(motivoAgendamentoInvalido({ ...ATIVO, quando: 'sempre' }, GRADE, ok, 'entrega', true, AGORA)).toBeNull()
  })
})

describe('liberação e textos', () => {
  it('pedidoLiberado: X minutos antes', () => {
    const para = '2026-10-01T22:30:00Z' // 19:30 SP
    expect(pedidoLiberado(para, 30, new Date('2026-10-01T21:59:00Z'))).toBe(false)
    expect(pedidoLiberado(para, 30, new Date('2026-10-01T22:00:00Z'))).toBe(true)
    expect(pedidoLiberado(null, 30)).toBe(true)
  })
  it('podeAgendar / somenteAgendado', () => {
    expect(podeAgendar(AGENDAMENTO_PADRAO, false)).toBe(false)
    expect(somenteAgendado(ATIVO, false)).toBe(true)
    expect(podeAgendar(ATIVO, true)).toBe(false)
    expect(podeAgendar({ ...ATIVO, quando: 'sempre' }, true)).toBe(true)
  })
  it('textoAgendado e textoAbrimos', () => {
    expect(textoAgendado(instanteDoHorario('2026-10-01', '19:30'), AGORA)).toBe('hoje às 19:30')
    expect(textoAgendado(instanteDoHorario('2026-10-02', '19:30'), AGORA)).toBe('amanhã às 19:30')
    expect(textoAgendado(instanteDoHorario('2026-10-04', '13:00'), AGORA)).toBe('domingo, 04/10 às 13:00')
    expect(textoAbrimos({ diaSemana: 4, hora: '18:00' }, AGORA)).toBe('Abrimos hoje (quinta) às 18:00')
    expect(textoAbrimos({ diaSemana: 5, hora: '18:00' }, AGORA)).toBe('Abrimos amanhã (sexta) às 18:00')
    expect(textoAbrimos({ diaSemana: 0, hora: '13:00' }, AGORA)).toBe('Abrimos domingo às 13:00')
  })
})
