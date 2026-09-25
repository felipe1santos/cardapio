import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn() }))
const { sanearDiagnostico } = await import('./servico')

describe('diagnóstico do driver vindo do Assistente Beta', () => {
  it('guarda só campos conhecidos, arredondados e curtos', () => {
    const d = sanearDiagnostico({
      driver: '  POS-80C  ', dpiX: 203.456, online: true, papelNome: 'x'.repeat(200),
      caminho: 'C:\Users\segredo', token: 'mza_ag_vazou', dpiY: Number.NaN, pontosImprimiveis: '512',
    })
    expect(d).toEqual({ driver: 'POS-80C', dpiX: 203.46, online: true, papelNome: 'x'.repeat(80), pontosImprimiveis: '512' })
  })
  it('lixo vira nulo', () => {
    expect(sanearDiagnostico(null)).toBeNull()
    expect(sanearDiagnostico([1, 2])).toBeNull()
    expect(sanearDiagnostico({ nada: 1 })).toBeNull()
  })
})
