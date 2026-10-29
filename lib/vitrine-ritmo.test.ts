import { describe, expect, it } from 'vitest'
import { ritmoPedidos } from './vitrine-ritmo'

const base = { abaPedidosAberta: false, detalheAberto: false, temPedidoAtivo: false, entregaEmCurso: false }

describe('ritmoPedidos', () => {
  it('aba Meus pedidos aberta: 8 s', () => {
    expect(ritmoPedidos({ ...base, abaPedidosAberta: true })).toBe(8000)
  })
  it('detalhe do pedido aberto: 8 s', () => {
    expect(ritmoPedidos({ ...base, detalheAberto: true })).toBe(8000)
  })
  it('entrega em curso fora da aba: 15 s', () => {
    expect(ritmoPedidos({ ...base, temPedidoAtivo: true, entregaEmCurso: true })).toBe(15000)
  })
  it('pedido ativo sem entrega: 30 s', () => {
    expect(ritmoPedidos({ ...base, temPedidoAtivo: true })).toBe(30000)
  })
  it('sem pedido ativo e sem aba aberta: não consulta (null)', () => {
    expect(ritmoPedidos(base)).toBeNull()
  })
  it('aba aberta vale mesmo sem pedido ativo (para ver o histórico)', () => {
    expect(ritmoPedidos({ ...base, abaPedidosAberta: true, temPedidoAtivo: false })).toBe(8000)
  })
  it('pedido entregue há 1 min ainda conta como ativo até o status final ser lido: segue consultando', () => {
    // O servidor ainda não devolveu "entregue" para o aparelho: o último status lido é "em_rota".
    expect(ritmoPedidos({ ...base, temPedidoAtivo: true })).not.toBeNull()
  })
})
