import { describe, expect, it } from 'vitest'
import { motivoForaDaVitrine } from './item-visibilidade'

// Segunda-feira, 2 de novembro de 2026, 19:10 em São Paulo (22:10 UTC).
const SEGUNDA_19H = new Date('2026-11-02T22:10:00Z')
const TODOS = [0, 1, 2, 3, 4, 5, 6]
const base = { status: 'disponivel', grupoId: 'g1', diasDisponiveis: TODOS, disponivelDelivery: true, disponivelSalao: true }
const grupoSemHorario = { horarioAtivoInicio: null, horarioAtivoFim: null }

describe('motivoForaDaVitrine', () => {
  it('item completo aparece: sem motivo', () => {
    expect(motivoForaDaVitrine(base, grupoSemHorario, SEGUNDA_19H)).toBeNull()
  })

  it('pausado/esgotado já tem o badge próprio: sem motivo extra', () => {
    expect(motivoForaDaVitrine({ ...base, status: 'pausado', grupoId: null }, undefined, SEGUNDA_19H)).toBeNull()
    expect(motivoForaDaVitrine({ ...base, status: 'esgotado', diasDisponiveis: [] }, grupoSemHorario, SEGUNDA_19H)).toBeNull()
  })

  it('caso Ferraz (02/11): dias dom/qui/sex/sáb numa segunda', () => {
    expect(motivoForaDaVitrine({ ...base, diasDisponiveis: [0, 4, 5, 6] }, grupoSemHorario, SEGUNDA_19H))
      .toBe('Hoje (segunda) não aparece na vitrine: só dom, qui, sex e sáb.')
  })

  it('nenhum dia marcado: nunca aparece', () => {
    expect(motivoForaDaVitrine({ ...base, diasDisponiveis: [] }, grupoSemHorario, SEGUNDA_19H))
      .toBe('Nenhum dia marcado: não aparece na vitrine.')
  })

  it('sem categoria', () => {
    expect(motivoForaDaVitrine({ ...base, grupoId: null }, undefined, SEGUNDA_19H))
      .toBe('Sem categoria: não aparece na vitrine.')
  })

  it('só salão', () => {
    expect(motivoForaDaVitrine({ ...base, disponivelDelivery: false }, grupoSemHorario, SEGUNDA_19H))
      .toBe('Só no salão: não aparece na vitrine.')
  })

  it('categoria fora do horário agora', () => {
    expect(motivoForaDaVitrine(base, { horarioAtivoInicio: '11:00', horarioAtivoFim: '15:00' }, SEGUNDA_19H))
      .toBe('Categoria fora do horário agora (11:00–15:00): não aparece na vitrine.')
    expect(motivoForaDaVitrine(base, { horarioAtivoInicio: '18:00', horarioAtivoFim: '23:00' }, SEGUNDA_19H)).toBeNull()
  })

  it('um motivo por vez, na ordem em que o lojista corrige', () => {
    expect(motivoForaDaVitrine({ ...base, grupoId: null, disponivelDelivery: false, diasDisponiveis: [] }, undefined, SEGUNDA_19H))
      .toBe('Sem categoria: não aparece na vitrine.')
    expect(motivoForaDaVitrine({ ...base, disponivelDelivery: false, diasDisponiveis: [] }, grupoSemHorario, SEGUNDA_19H))
      .toBe('Só no salão: não aparece na vitrine.')
  })

  it('dia da semana é o de São Paulo, não o UTC', () => {
    // 23:30 de domingo em SP = 02:30 de segunda em UTC.
    const domingoNoite = new Date('2026-11-02T02:30:00Z')
    expect(motivoForaDaVitrine({ ...base, diasDisponiveis: [0] }, grupoSemHorario, domingoNoite)).toBeNull()
  })
})
