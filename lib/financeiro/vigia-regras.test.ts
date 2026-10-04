import { describe, expect, it } from 'vitest'
import { descontoAlto, minutosDesdeAbertura } from './vigia-regras'

const grade = { '1': [{ abre: '11:00', fecha: '15:00' }, { abre: '18:00', fecha: '02:00' }] }

describe('vigia: horário de funcionamento', () => {
  it('minutos desde que abriu no turno corrente', () => {
    expect(minutosDesdeAbertura({ statusLoja: 'automatico', grade, dia: 1, hora: '11:45' })).toBe(45)
    expect(minutosDesdeAbertura({ statusLoja: 'automatico', grade, dia: 1, hora: '16:00' })).toBeNull()
    expect(minutosDesdeAbertura({ statusLoja: 'automatico', grade, dia: 1, hora: '19:30' })).toBe(90)
  })
  it('turno que vira a meia-noite conta no dia seguinte', () => {
    expect(minutosDesdeAbertura({ statusLoja: 'automatico', grade, dia: 2, hora: '01:00' })).toBe(7 * 60)
  })
  it('sem grade ou status manual: não dá para saber (sem alerta)', () => {
    expect(minutosDesdeAbertura({ statusLoja: 'automatico', grade: null, dia: 1, hora: '12:00' })).toBeNull()
    expect(minutosDesdeAbertura({ statusLoja: 'aberto_manual', grade, dia: 1, hora: '12:00' })).toBeNull()
  })
})

describe('vigia: desconto alto', () => {
  const lim = { limitePct: 10, limiteCentavos: 2000 }
  it('acima de 10% ou de R$ 20,00', () => {
    expect(descontoAlto({ descontoCentavos: 1100, subtotalCentavos: 10000, ...lim })).toBe(true)
    expect(descontoAlto({ descontoCentavos: 1000, subtotalCentavos: 10000, ...lim })).toBe(false)
    expect(descontoAlto({ descontoCentavos: 2100, subtotalCentavos: 100000, ...lim })).toBe(true)
    expect(descontoAlto({ descontoCentavos: 0, subtotalCentavos: 0, ...lim })).toBe(false)
  })
})
