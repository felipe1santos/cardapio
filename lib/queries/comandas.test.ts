import { describe, it, expect } from 'vitest'
import { mapComandaRow, calcularTotalComanda } from './comandas'
import type { Pedido } from './pedidos'

describe('mapComandaRow', () => {
  it('mapeia uma linha do banco para Comanda', () => {
    const row = {
      id: 'c1',
      restaurante_id: 'r1',
      mesa_id: 'm1',
      status: 'aberta',
      aberta_em: '2026-06-27T10:00:00Z',
      fechada_em: null,
    }
    expect(mapComandaRow(row)).toEqual({
      id: 'c1',
      mesaId: 'm1',
      status: 'aberta',
      abertaEm: '2026-06-27T10:00:00Z',
      fechadaEm: null,
    })
  })
})

describe('calcularTotalComanda', () => {
  const base = { itens: [] } as unknown as Pedido
  it('soma o total dos pedidos não-cancelados', () => {
    const pedidos = [
      { ...base, status: 'recebido', total: 30 },
      { ...base, status: 'preparando', total: 20 },
    ] as Pedido[]
    expect(calcularTotalComanda(pedidos)).toBe(50)
  })

  it('ignora pedidos cancelados', () => {
    const pedidos = [
      { ...base, status: 'recebido', total: 30 },
      { ...base, status: 'cancelado', total: 99 },
    ] as Pedido[]
    expect(calcularTotalComanda(pedidos)).toBe(30)
  })

  it('retorna 0 para comanda sem pedidos', () => {
    expect(calcularTotalComanda([])).toBe(0)
  })
})
