import { describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

const ITEM = {
  id: 'i', nome: 'X', preco: 20, promocao_preco: null, status: 'disponivel', tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], tamanhos_item: [], pizza_sabores: [],
}

/** Cliente 5527999990000 já verificado, token "tok-certo". */
function supabaseFake() {
  const pedidoInsert = vi.fn()
  const loja = { status_loja: 'aberto_manual', horario_funcionamento: null, aceita_entrega: true, aceita_retirada: true, pizza_calculo_preco: 'media', frete_gratis_acima: null }
  const from = vi.fn((tabela: string) => {
    switch (tabela) {
      case 'restaurantes':
        return { select: () => ({ eq: () => ({ single: async () => ({ data: loja, error: null }), maybeSingle: async () => ({ data: loja, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }
      case 'itens_cardapio':
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [ITEM], error: null }) }) }) }
      case 'clientes': {
        const f: Record<string, unknown> = {}
        const b = { select: () => b, eq: (k: string, v: unknown) => { f[k] = v; return b }, maybeSingle: async () => ({ data: !('token' in f) || f.token === 'tok-certo' ? { verificado_em: '2026-09-01T00:00:00Z' } : null, error: null }) }
        return b
      }
      case 'pedidos':
        return { insert: (row: unknown) => { pedidoInsert(row); return { select: () => ({ single: async () => ({ data: { id: 'p', numero: 1 }, error: null }) }) } } }
      case 'pedido_itens':
        return { insert: async () => ({ error: null }) }
      default:
        throw new Error(tabela)
    }
  })
  return { client: { from } as never, pedidoInsert }
}

const input = (over: Partial<NovoPedidoInput> = {}): NovoPedidoInput => ({
  tipo: 'retirada', cliente: { nome: 'Fulano', telefone: '5527999990000' },
  endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '' },
  pagamento: 'pix', trocoPara: null, itens: [{ itemId: 'i', quantidade: 1, complementos: [], observacao: '' }], ...over,
})

describe('pedido da vitrine "verificado"', () => {
  it('só com o token do cadastro do telefone', async () => {
    for (const [token, esperado] of [['tok-certo', true], [undefined, false], ['tok-errado', false]] as const) {
      const { client, pedidoInsert } = supabaseFake()
      await criarPedido(client, 'r1', input({ clienteToken: token }))
      expect(pedidoInsert.mock.calls[0][0].telefone_verificado).toBe(esperado)
    }
  })
})
