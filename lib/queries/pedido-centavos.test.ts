import { describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

const ITEM = {
  id: 'item-1', nome: 'X-Burger', preco: 19.9, promocao_preco: null, status: 'disponivel', tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], tamanhos_item: [], pizza_sabores: [],
}

function supabaseFake() {
  const pedidoInsert = vi.fn()
  const loja = {
    status_loja: 'aberta', horario_funcionamento: null, aceita_entrega: true, aceita_retirada: true,
    pizza_calculo_preco: 'media', taxa_entrega_padrao: 7, latitude: null, longitude: null, cep: '', endereco: '',
    frete_fora_da_lista: 'taxa_padrao', frete_gratis_acima: 59.7,
  }
  const from = vi.fn((tabela: string) => {
    switch (tabela) {
      case 'restaurantes':
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: loja, error: null }), maybeSingle: async () => ({ data: loja, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      case 'itens_cardapio':
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [ITEM], error: null }) }) }) }
      case 'taxas_entrega_bairro':
        return { select: () => ({ eq: async () => ({ data: [{ bairro: 'Centro', taxa: 5 }], error: null }) }) }
      case 'taxas_entrega_raio':
        return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }
      case 'clientes':
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
      case 'pedidos':
        return { insert: (row: unknown) => { pedidoInsert(row); return { select: () => ({ single: async () => ({ data: { id: 'p', numero: 1 }, error: null }) }) } } }
      case 'pedido_itens':
        return { insert: async () => ({ error: null }) }
      default:
        throw new Error(`tabela inesperada: ${tabela}`)
    }
  })
  return { client: { from } as never, pedidoInsert }
}

const input = (): NovoPedidoInput => ({
  tipo: 'entrega',
  cliente: { nome: 'Fulano', telefone: '5527999990000' },
  endereco: { rua: 'Rua A', numero: '1', complemento: '', bairro: 'Centro', cep: '', cidade: 'Vila Velha' },
  pagamento: 'pix',
  trocoPara: null,
  itens: [{ itemId: 'item-1', quantidade: 3, complementos: [], observacao: '' }],
})

describe('criarPedido — centavos', () => {
  it('3 × R$ 19,90 = R$ 59,70 e ganha o frete grátis "acima de R$ 59,70"', async () => {
    const { client, pedidoInsert } = supabaseFake()
    await criarPedido(client, 'r1', input())
    const row = pedidoInsert.mock.calls[0][0]
    expect(row.subtotal).toBe(59.7)
    expect(row.taxa_entrega).toBe(0)
    expect(row.total).toBe(59.7)
  })
})
