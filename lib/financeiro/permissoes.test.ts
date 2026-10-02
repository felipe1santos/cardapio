import { describe, expect, it } from 'vitest'
import { acoesFin, podeFin } from './permissoes'

describe('permissões do financeiro', () => {
  it('dono pode tudo, inclusive reabrir caixa', () => {
    expect(podeFin('dono', null, 'caixa_reabrir')).toBe(true)
    expect(podeFin('dono', { areas: [], sensiveis: [] }, 'sangria')).toBe(true)
  })
  it('ninguém além do dono reabre caixa, mesmo marcado', () => {
    expect(podeFin('gerente', null, 'caixa_reabrir')).toBe(false)
    expect(podeFin('gerente', { areas: ['financeiro'], sensiveis: ['caixa_reabrir'] }, 'caixa_reabrir')).toBe(false)
  })
  it('padrão do papel', () => {
    expect(podeFin('gerente', null, 'aprovar')).toBe(true)
    expect(podeFin('atendente', null, 'caixa_abrir')).toBe(true)
    expect(podeFin('atendente', null, 'sangria')).toBe(false)
    expect(podeFin('atendente', null, 'financeiro')).toBe(false)
    expect(podeFin('garcom', null, 'receber_pagamento')).toBe(false)
    expect(podeFin('logistica', null, 'acerto_motoboy')).toBe(true)
    expect(podeFin(null, null, 'financeiro')).toBe(false)
  })
  it('acessos próprios mandam', () => {
    const a = { areas: ['financeiro'] as never[], sensiveis: ['sangria'] as never[] }
    expect(podeFin('atendente', a, 'financeiro')).toBe(true)
    expect(podeFin('atendente', a, 'sangria')).toBe(true)
    expect(podeFin('gerente', a, 'aprovar')).toBe(false)
    expect(acoesFin('atendente', a)).toEqual(['financeiro', 'sangria'])
  })
})
