import { describe, it, expect } from 'vitest'
import { mascararTelefoneBR, telefoneCompleto } from './telefone'

describe('mascararTelefoneBR', () => {
  it('formata celular com DDD', () => {
    expect(mascararTelefoneBR('27999999999')).toBe('(27) 99999-9999')
  })

  it('formata fixo com DDD', () => {
    expect(mascararTelefoneBR('2733334444')).toBe('(27) 3333-4444')
  })

  it('formata enquanto o cliente digita', () => {
    expect(mascararTelefoneBR('')).toBe('')
    expect(mascararTelefoneBR('2')).toBe('(2')
    expect(mascararTelefoneBR('27')).toBe('(27')
    expect(mascararTelefoneBR('279')).toBe('(27) 9')
    expect(mascararTelefoneBR('279999')).toBe('(27) 9999')
    expect(mascararTelefoneBR('2799999')).toBe('(27) 9999-9')
  })

  it('descarta o DDI colado do WhatsApp', () => {
    expect(mascararTelefoneBR('+55 27 99999-9999')).toBe('(27) 99999-9999')
    expect(mascararTelefoneBR('5527999999999')).toBe('(27) 99999-9999')
  })

  it('ignora dígitos além do 11º', () => {
    expect(mascararTelefoneBR('279999999990000')).toBe('(27) 99999-9999')
  })

  it('não trata 55 como DDI quando ele é o próprio DDD', () => {
    // (55) 9999-9999 é um fixo de Santa Maria/RS: 10 dígitos, o 55 fica.
    expect(mascararTelefoneBR('5599999999')).toBe('(55) 9999-9999')
  })
})

describe('telefoneCompleto', () => {
  it('aceita fixo e celular', () => {
    expect(telefoneCompleto('(27) 3333-4444')).toBe(true)
    expect(telefoneCompleto('(27) 99999-9999')).toBe(true)
    expect(telefoneCompleto('+55 27 99999-9999')).toBe(true)
  })

  it('recusa número incompleto', () => {
    expect(telefoneCompleto('')).toBe(false)
    expect(telefoneCompleto('(27) 9999')).toBe(false)
    expect(telefoneCompleto('279')).toBe(false)
  })
})
