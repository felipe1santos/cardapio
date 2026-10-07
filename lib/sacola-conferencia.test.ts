import { describe, expect, it } from 'vitest'
import { classificarIndisponivel, motivoBloqueioSacola } from './sacola-conferencia'

describe('conferência da sacola', () => {
  it('classifica as mensagens do servidor em textos simples', () => {
    expect(classificarIndisponivel('Item "X-Bacon" não está disponível', false)).toEqual({ tipo: 'indisponivel', motivo: 'Indisponível no momento.' })
    expect(classificarIndisponivel('Item "X" não está disponível hoje', false).motivo).toBe('Não é vendido hoje.')
    expect(classificarIndisponivel('Item "X" não está disponível no dia agendado', true).tipo).toBe('fora_do_dia')
    expect(classificarIndisponivel('"Almoço PF" só é vendido em outro horário.', true).motivo).toBe('Não é vendido no horário agendado.')
    expect(classificarIndisponivel('Item abc não encontrado nesta loja', false).tipo).toBe('removido')
    expect(classificarIndisponivel('X-Bacon: a opção "Bacon extra" não está disponível.', false).tipo).toBe('opcao')
    expect(classificarIndisponivel('Item "X" não é vendido neste canal', false).tipo).toBe('canal')
  })
  it('bloqueio do Continuar em linguagem simples', () => {
    expect(motivoBloqueioSacola(0)).toBeNull()
    expect(motivoBloqueioSacola(1)).toBe('Um item da sacola está indisponível. Remova para continuar.')
    expect(motivoBloqueioSacola(2)).toMatch(/^2 itens/)
  })
})
