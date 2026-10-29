import { describe, it, expect, beforeEach, vi } from 'vitest'
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn() }))
const { precisaGravarDescoberta, marcarDescobertaGravada, esquecerDescoberta } = await import('./descoberta-memo')

const T0 = 1_000_000_000_000
const min = (n: number) => n * 60_000
const diag = (papel: number) => ({ 'EPSON': { papelLarguraMm: papel, driver: 'x', ruido: 'ignorado' } })

describe('memo da descoberta de impressoras', () => {
  beforeEach(() => esquecerDescoberta())

  it('primeira vez grava; mesma lista 2x em 60 s não', () => {
    expect(precisaGravarDescoberta('a1', ['A', 'B'], diag(80), T0)).toBe(true)
    marcarDescobertaGravada('a1', ['A', 'B'], diag(80), T0)
    expect(precisaGravarDescoberta('a1', ['B', 'A'], diag(80), T0 + 60_000)).toBe(false)
  })
  it('impressora a mais ou a menos grava', () => {
    marcarDescobertaGravada('a1', ['A', 'B'], undefined, T0)
    expect(precisaGravarDescoberta('a1', ['A', 'B', 'C'], undefined, T0 + 1000)).toBe(true)
    expect(precisaGravarDescoberta('a1', ['A'], undefined, T0 + 1000)).toBe(true)
  })
  it('diagnóstico mudou (papel 58 para 80) grava; campo de ruído não', () => {
    marcarDescobertaGravada('a1', ['EPSON'], diag(58), T0)
    expect(precisaGravarDescoberta('a1', ['EPSON'], diag(80), T0 + 1000)).toBe(true)
    expect(precisaGravarDescoberta('a1', ['EPSON'], { EPSON: { papelLarguraMm: 58, driver: 'x', outro: 1 } }, T0 + 1000)).toBe(false)
  })
  it('31 min depois grava de novo', () => {
    marcarDescobertaGravada('a1', ['A'], undefined, T0)
    expect(precisaGravarDescoberta('a1', ['A'], undefined, T0 + min(29))).toBe(false)
    expect(precisaGravarDescoberta('a1', ['A'], undefined, T0 + min(31))).toBe(true)
  })
  it('esquecerDescoberta(id) força a próxima; agentes não se misturam', () => {
    marcarDescobertaGravada('a1', ['A'], undefined, T0)
    marcarDescobertaGravada('a2', ['A'], undefined, T0)
    esquecerDescoberta('a1')
    expect(precisaGravarDescoberta('a1', ['A'], undefined, T0 + 1000)).toBe(true)
    expect(precisaGravarDescoberta('a2', ['A'], undefined, T0 + 1000)).toBe(false)
  })
})
