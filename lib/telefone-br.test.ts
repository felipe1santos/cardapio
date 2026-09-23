import { describe, it, expect } from 'vitest'
import { motivoTelefoneDoPedido, motivoTelefoneInvalido, telefoneBrValido, telefoneWhatsapp } from './telefone-br'

describe('telefoneWhatsapp', () => {
  it('celular com DDD ganha o DDI', () => {
    expect(telefoneWhatsapp('(27) 99999-8888')).toBe('5527999998888')
    expect(telefoneWhatsapp('27999998888')).toBe('5527999998888')
  })

  it('fixo de 8 dígitos também', () => {
    expect(telefoneWhatsapp('(27) 3221-4455')).toBe('552732214455')
  })

  it('número que já veio com DDI fica como está', () => {
    expect(telefoneWhatsapp('5527999998888')).toBe('5527999998888')
    expect(telefoneWhatsapp('+55 27 3221-4455')).toBe('552732214455')
  })

  /**
   * O caso que quebrava: DDD 55 é Santa Maria/RS. Pela regra antiga o número
   * saía sem DDI e a mensagem ia para outro lugar.
   */
  it('DDD 55 (RS) não é confundido com o DDI', () => {
    expect(telefoneWhatsapp('(55) 99999-8888')).toBe('5555999998888')
    expect(telefoneWhatsapp('(55) 3221-4455')).toBe('555532214455')
  })

  it('DDI + DDD 55 continua valendo', () => {
    expect(telefoneWhatsapp('5555999998888')).toBe('5555999998888')
  })

  /** Três clientes em produção estavam gravados assim, com um dígito a mais. */
  it('recusa número com dígito sobrando', () => {
    expect(telefoneWhatsapp('55279950921011')).toBeNull()
    expect(telefoneWhatsapp('(27) 99509-21011')).toBeNull()
  })

  it('recusa número curto demais e lixo', () => {
    expect(telefoneWhatsapp('999998888')).toBeNull()
    expect(telefoneWhatsapp('')).toBeNull()
    expect(telefoneWhatsapp('não sei')).toBeNull()
  })

  it('recusa 12 ou 13 dígitos que não comecem com 55', () => {
    expect(telefoneWhatsapp('351912345678')).toBeNull()
  })
})

describe('telefoneBrValido e motivo', () => {
  it('diz o que está errado, e nada quando está certo', () => {
    expect(telefoneBrValido('27999998888')).toBe(true)
    expect(motivoTelefoneInvalido('27999998888')).toBeNull()
    expect(motivoTelefoneInvalido('2799999')).toMatch(/Faltam dígitos/)
    expect(motivoTelefoneInvalido('55279950921011')).toMatch(/dígitos demais/)
  })
})

describe('motivoTelefoneDoPedido', () => {
  it('PDV e mesa sem telefone passam', () => {
    expect(motivoTelefoneDoPedido('', 'pdv')).toBeNull()
    expect(motivoTelefoneDoPedido('   ', 'pdv')).toBeNull()
  })
  it('PDV com telefone digitado ainda é conferido', () => {
    expect(motivoTelefoneDoPedido('2799', 'pdv')).toMatch(/Faltam dígitos/)
    expect(motivoTelefoneDoPedido('27999998888', 'pdv')).toBeNull()
  })
  it('cardápio continua exigindo telefone', () => {
    expect(motivoTelefoneDoPedido('', 'cardapio')).toMatch(/Faltam dígitos/)
    expect(motivoTelefoneDoPedido('', undefined)).toMatch(/Faltam dígitos/)
  })
})
