import { describe, expect, it } from 'vitest'
import { autoTravaPermitida, deveTravar } from './trava'

const base = { financeiroAtivo: true, temPin: true, travada: false, inatividadeMin: 5, pathname: '/admin/financeiro', ultimaAtividade: 0, agora: 5 * 60_000 }

describe('trava por inatividade', () => {
  it('trava depois do tempo, com flag e PIN', () => {
    expect(deveTravar(base)).toBe(true)
    expect(deveTravar({ ...base, agora: 5 * 60_000 - 1 })).toBe(false)
  })
  it('nunca trava sem a flag, sem PIN, já travada ou com inatividade 0', () => {
    expect(deveTravar({ ...base, financeiroAtivo: false })).toBe(false)
    expect(deveTravar({ ...base, temPin: false })).toBe(false)
    expect(deveTravar({ ...base, travada: true })).toBe(false)
    expect(deveTravar({ ...base, inatividadeMin: 0 })).toBe(false)
  })
  it('telas de operação contínua não travam sozinhas', () => {
    for (const p of ['/admin/pedidos', '/admin/logistica', '/admin/pdv', '/admin/pdv/balcao', '/admin/mesas', '/admin/mesas/12', '/admin/cozinha']) {
      expect(autoTravaPermitida(p)).toBe(false)
      expect(deveTravar({ ...base, pathname: p })).toBe(false)
    }
    expect(autoTravaPermitida('/admin/pedidos-antigos')).toBe(true)
    expect(autoTravaPermitida('/admin/dashboard')).toBe(true)
  })
})
