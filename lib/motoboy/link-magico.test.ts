import { describe, expect, it } from 'vitest'
import { linkMagicoValido } from './link-magico'

describe('prazo do link mágico (10/10)', () => {
  it('vale até 17/10 23:59 de Brasília e para depois', () => {
    expect(linkMagicoValido(Date.parse('2026-10-17T23:59:00-03:00'), {})).toBe(true)
    expect(linkMagicoValido(Date.parse('2026-10-18T00:00:01-03:00'), {})).toBe(false)
  })
  it('o Coolify pode mudar o prazo', () => {
    expect(linkMagicoValido(Date.parse('2026-10-12T00:00:00-03:00'), { LINK_MAGICO_ATE: '2026-10-11T00:00:00-03:00' })).toBe(false)
  })
})
