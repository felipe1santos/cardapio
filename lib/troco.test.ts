import { describe, it, expect } from 'vitest'
import { erroDoTroco, trocoALevar, TROCO_MENOR_QUE_TOTAL } from './troco'

describe('erroDoTroco', () => {
  it('sem troco pedido, segue', () => {
    expect(erroDoTroco(67, null)).toBeNull()
    expect(erroDoTroco(67, undefined)).toBeNull()
    expect(erroDoTroco(67, 0)).toBeNull()
  })

  it('troco que cobre a conta, segue', () => {
    expect(erroDoTroco(67, 100)).toBeNull()
    expect(erroDoTroco(67, 67)).toBeNull()
  })

  /** O caso real: pedido #76, R$ 67,00, "troco para R$ 50,00". */
  it('barra troco menor que o total', () => {
    expect(erroDoTroco(67, 50)).toBe(TROCO_MENOR_QUE_TOTAL)
    expect(erroDoTroco(72.5, 50)).toBe(TROCO_MENOR_QUE_TOTAL)
  })

  it('não implica com centavo de arredondamento', () => {
    expect(erroDoTroco(50.004, 50)).toBeNull()
    expect(erroDoTroco(50.5, 50)).toBe(TROCO_MENOR_QUE_TOTAL)
  })

  it('valor impossível é tratado como "sem troco", não como erro', () => {
    expect(erroDoTroco(67, Number.NaN)).toBeNull()
    expect(erroDoTroco(67, -10)).toBeNull()
  })
})

describe('trocoALevar', () => {
  it('é a diferença, e zero quando não há troco a levar', () => {
    expect(trocoALevar(67, 100)).toBe(33)
    expect(trocoALevar(67, 67)).toBe(0)
    expect(trocoALevar(67, null)).toBe(0)
    expect(trocoALevar(67, 50)).toBe(0)
  })

  it('arredonda em centavos', () => {
    expect(trocoALevar(33.33, 50)).toBe(16.67)
  })
})
