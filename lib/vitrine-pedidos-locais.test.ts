import { describe, expect, it, vi } from 'vitest'
import { atualizarStatusLocais, pedidoLocal } from './vitrine-pedidos-locais'

const base = pedidoLocal({
  id: 'p1', numero: 42, tipo: 'entrega', formaPagamento: 'pix', subtotal: 30, desconto: 0, taxaEntrega: 5, total: 35,
  itens: [], agora: new Date('2026-09-29T12:00:00Z'),
})

describe('pedidos guardados no aparelho (sessão sem código confirmado)', () => {
  it('pedido nasce "recebido" com os dados do checkout', () => {
    expect(base).toMatchObject({ id: 'p1', numero: 42, status: 'recebido', total: 35, criadoEm: '2026-09-29T12:00:00.000Z' })
  })

  it('status vem da rota pública; entregue/cancelado não são consultados de novo', async () => {
    const buscar = vi.fn(async () => ({ status: 'em_rota' as const }))
    const lista = await atualizarStatusLocais([base, { ...base, id: 'p2', status: 'entregue' }], buscar)
    expect(lista.map((p) => p.status)).toEqual(['em_rota', 'entregue'])
    expect(buscar).toHaveBeenCalledTimes(1)
  })

  it('falha de rede ou pedido não encontrado mantém o status conhecido', async () => {
    expect((await atualizarStatusLocais([base], async () => { throw new Error('offline') }))[0].status).toBe('recebido')
    expect((await atualizarStatusLocais([base], async () => null))[0].status).toBe('recebido')
  })
})
