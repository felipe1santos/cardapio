import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarAgrupadorPdv, reacaoDoPdv } from './pdv-eventos'

/**
 * Achado #24 da auditoria (25/10): o PDV relia mesas e a comanda aberta a cada evento de `pedidos` da loja — inclusive
 * delivery, que não muda mesa nem comanda. Aqui: o que cada evento precisa recarregar.
 */

const upd = (n: Record<string, unknown>) => ({ eventType: 'UPDATE', new: { id: 'p1', ...n }, old: { id: 'p1' } })

describe('reacaoDoPdv', () => {
  it('delivery sem comanda não recarrega nada', () => {
    expect(reacaoDoPdv(upd({ canal: 'delivery', comanda_id: null }), 'c1')).toEqual({ mesas: false, comanda: false })
  })

  it('pedido de mesa recarrega o mapa e a comanda aberta', () => {
    expect(reacaoDoPdv(upd({ canal: 'mesa', comanda_id: 'c1' }), 'c1')).toEqual({ mesas: true, comanda: true })
  })

  it('pedido passou para OUTRA comanda (transferência): a aberta recarrega — ele pode ter saído dela', () => {
    // O evento só traz o comanda_id novo; o antigo não vem (replica identity padrão). Revisão 26/10.
    expect(reacaoDoPdv(upd({ canal: 'mesa', comanda_id: 'c2' }), 'c1')).toEqual({ mesas: true, comanda: true })
  })

  it('balcão também é do PDV', () => {
    expect(reacaoDoPdv(upd({ canal: 'balcao', comanda_id: 'c9' }), null).mesas).toBe(true)
  })

  it('delivery ligado a uma comanda (lançado no PDV) conta', () => {
    expect(reacaoDoPdv(upd({ canal: 'delivery', comanda_id: 'c1' }), 'c1')).toEqual({ mesas: true, comanda: true })
  })

  it('evento sem os dados (DELETE, só a chave) recarrega tudo por segurança', () => {
    expect(reacaoDoPdv({ eventType: 'DELETE', new: {}, old: { id: 'p1' } }, 'c1')).toEqual({ mesas: true, comanda: true })
  })

  it('sem comanda aberta, nunca pede a comanda', () => {
    expect(reacaoDoPdv(upd({ canal: 'mesa', comanda_id: 'c1' }), null).comanda).toBe(false)
  })
})

describe('criarAgrupadorPdv (debounce)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('rajada vira uma recarga, com a união do que foi pedido', () => {
    const executar = vi.fn()
    const a = criarAgrupadorPdv(400, executar)
    a.pedir({ mesas: true, comanda: false })
    a.pedir({ mesas: false, comanda: true })
    a.pedir({ mesas: true, comanda: false })
    vi.advanceTimersByTime(400)
    expect(executar).toHaveBeenCalledTimes(1)
    expect(executar).toHaveBeenCalledWith({ mesas: true, comanda: true })
  })

  it('nada a recarregar não agenda nada', () => {
    const executar = vi.fn()
    criarAgrupadorPdv(400, executar).pedir({ mesas: false, comanda: false })
    vi.advanceTimersByTime(1000)
    expect(executar).not.toHaveBeenCalled()
  })

  it('cancelar descarta o pendente', () => {
    const executar = vi.fn()
    const a = criarAgrupadorPdv(400, executar)
    a.pedir({ mesas: true, comanda: false })
    a.cancelar()
    vi.advanceTimersByTime(1000)
    expect(executar).not.toHaveBeenCalled()
  })
})
