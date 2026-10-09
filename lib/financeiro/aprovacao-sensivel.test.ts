import { describe, expect, it } from 'vitest'
import { foiParaCozinha, precisaSegundaPessoa } from './aprovacao-sensivel'

describe('estorno e cancelamento depois da cozinha', () => {
  it('pede o PIN de outra pessoa só com o financeiro ligado e para quem não é o dono', () => {
    expect(precisaSegundaPessoa({ financeiroAtivo: true, papel: 'gerente' })).toBe(true)
    expect(precisaSegundaPessoa({ financeiroAtivo: true, papel: 'atendente' })).toBe(true)
    expect(precisaSegundaPessoa({ financeiroAtivo: true, papel: 'dono' })).toBe(false)
    expect(precisaSegundaPessoa({ financeiroAtivo: false, papel: 'gerente' })).toBe(false)
  })
  it('delivery: aceito ou impresso já foi para a cozinha; esperando Pix não', () => {
    expect(foiParaCozinha({ status: 'recebido', impresso: false })).toBe(false)
    expect(foiParaCozinha({ status: 'recebido', impresso: true })).toBe(true)
    for (const s of ['preparando', 'pronto', 'em_rota']) expect(foiParaCozinha({ status: s, impresso: false })).toBe(true)
    expect(foiParaCozinha({ status: 'aguardando_pagamento', impresso: false })).toBe(false)
  })
})
