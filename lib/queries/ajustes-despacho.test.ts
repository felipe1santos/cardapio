import { describe, expect, it } from 'vitest'
import { FLUXO_LOJA_PADRAO, usaDespachoDeRotas } from './ajustes'

describe('despacho de rotas (motoboy) por loja', () => {
  it('com Logística e com entregador: Rotas ligado, motoboy conclui pelo app', () => {
    expect(usaDespachoDeRotas({ usaLogistica: true, entregaSemEntregador: false })).toBe(true)
    // Loja que não leu a config ainda: comportamento de sempre.
    expect(usaDespachoDeRotas(FLUXO_LOJA_PADRAO)).toBe(true)
  })
  it('sem Logística (ex.: estancia-burger) ou com "entrega sem entregador": Rotas desligado', () => {
    expect(usaDespachoDeRotas({ usaLogistica: false, entregaSemEntregador: false })).toBe(false)
    expect(usaDespachoDeRotas({ usaLogistica: true, entregaSemEntregador: true })).toBe(false)
    expect(usaDespachoDeRotas({ usaLogistica: false, entregaSemEntregador: true })).toBe(false)
  })
})
