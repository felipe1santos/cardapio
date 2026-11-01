import { describe, expect, it, vi } from 'vitest'
import { criarAgrupador, deveRecarregarChecklist, intervaloPerguntaAssistente, intervaloPreConta } from './ritmo-telas'

/**
 * Fase 3 da auditoria de infraestrutura (01/11/2026): telas caras. Regras puras do ritmo de cada tela — espera
 * crescente com teto (regra 1 de docs/CORRECOES-DE-BUGS.md), pausa escondida e "desligado = zero consulta" (regra 3).
 */
describe('intervaloPreConta (PDV: acompanhar a via até sair o papel)', () => {
  it('rápido nos primeiros 15 s, depois 2 s, depois 5 s, e PARA aos 10 min', () => {
    expect(intervaloPreConta(3_000, true)).toBe(700)
    expect(intervaloPreConta(20_000, true)).toBe(2_000)
    expect(intervaloPreConta(90_000, true)).toBe(5_000)
    expect(intervaloPreConta(10 * 60_000, true)).toBeNull()
  })
  it('aba escondida: 5 s, sem consultar rápido', () => {
    expect(intervaloPreConta(3_000, false)).toBe(5_000)
  })
})

describe('intervaloPerguntaAssistente (painel: "o Assistente toca o alarme?")', () => {
  it('loja com Assistente: 15 s; loja sem Assistente pareado: 5 min (recurso desligado = quase zero consulta)', () => {
    expect(intervaloPerguntaAssistente({ assistente: true })).toBe(15_000)
    expect(intervaloPerguntaAssistente({ assistente: false })).toBe(15_000)
    expect(intervaloPerguntaAssistente({ assistente: false, semAssistente: true })).toBe(5 * 60_000)
    expect(intervaloPerguntaAssistente(null)).toBe(15_000)
  })
})

describe('deveRecarregarChecklist (painel: 9 consultas do checklist de configuração)', () => {
  it('na primeira carga sim; saindo de Ajustes/Cardápio/Equipe sim; alternando entre telas de operação não', () => {
    expect(deveRecarregarChecklist(null, '/admin/pedidos')).toBe(true)
    expect(deveRecarregarChecklist('/admin/ajustes', '/admin/pedidos')).toBe(true)
    expect(deveRecarregarChecklist('/admin/cardapio/itens', '/admin/kds')).toBe(true)
    expect(deveRecarregarChecklist('/admin/pedidos', '/admin/kds')).toBe(false)
    expect(deveRecarregarChecklist('/admin/kds', '/admin/pdv')).toBe(false)
    expect(deveRecarregarChecklist('/admin/financeiro', '/admin/dashboard')).toBe(false)
  })
})

describe('criarAgrupador (KDS e Rotas: vários eventos numa janela = 1 releitura)', () => {
  it('conta a janela do PRIMEIRO evento e chama uma vez; cancelar descarta', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const g = criarAgrupador(400, fn)
    g.chamar(); vi.advanceTimersByTime(200); g.chamar(); vi.advanceTimersByTime(150); g.chamar()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60)
    expect(fn).toHaveBeenCalledTimes(1)
    g.chamar(); g.cancelar(); vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
