import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assinaturaUberValida, enderecoUber, mensagemErroUber, statusDeUber, telefoneE164 } from './uber-direct'

describe('Uber Direct — regras puras', () => {
  it('endereço vai como JSON em texto, com país BR e CEP só números', () => {
    const e = JSON.parse(enderecoUber({ rua: 'Av. Hugo Musso', numero: '100', complemento: 'Loja 2', bairro: 'Praia da Costa', cidade: 'Vila Velha', estado: 'ES', cep: '29101-280', lat: -20.3, lng: -40.2 }))
    expect(e).toEqual({ street_address: ['Av. Hugo Musso, 100', 'Loja 2 — Praia da Costa'], city: 'Vila Velha', state: 'ES', zip_code: '29101280', country: 'BR' })
  })

  it('telefone em E.164', () => {
    expect(telefoneE164('(27) 99253-4407')).toBe('+5527992534407')
    expect(telefoneE164('5527992534407')).toBe('+5527992534407')
    expect(telefoneE164('')).toBe('')
  })

  it('status da Uber no vocabulário da corrida', () => {
    expect(statusDeUber('pending')).toBe('ASSIGNING_DRIVER')
    expect(statusDeUber('pickup')).toBe('ON_GOING')
    expect(statusDeUber('pickup_complete')).toBe('PICKED_UP')
    expect(statusDeUber('dropoff')).toBe('PICKED_UP')
    expect(statusDeUber('delivered')).toBe('COMPLETED')
    expect(statusDeUber('returned')).toBe('CANCELED')
    expect(statusDeUber('shopping_completed')).toBeNull()
  })

  it('fora da área vira "não atende"', () => {
    expect(mensagemErroUber(400, 'address_undeliverable', '')).toMatch(/não atende/)
    expect(mensagemErroUber(401, '', '')).toMatch(/Customer ID/)
  })

  it('assinatura do webhook (hex do corpo bruto)', () => {
    const corpo = '{"kind":"event.delivery_status","status":"delivered"}'
    const ok = createHmac('sha256', 'chave').update(corpo).digest('hex')
    expect(assinaturaUberValida(corpo, ok, 'chave')).toBe(true)
    expect(assinaturaUberValida(corpo, ok.toUpperCase(), 'chave')).toBe(true)
    expect(assinaturaUberValida(corpo + ' ', ok, 'chave')).toBe(false)
    expect(assinaturaUberValida(corpo, null, 'chave')).toBe(false)
  })
})
