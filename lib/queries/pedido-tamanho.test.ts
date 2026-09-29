import { describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

// Item com tamanhos (açaí, marmita): o preço mora no tamanho e o do item pode ser 0.
const ACAI = {
  id: 'acai', nome: 'Açaí', preco: 0, promocao_preco: null, status: 'disponivel', tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], pizza_sabores: [],
  tamanhos_item: [{ nome: '300 ml', preco: 14 }, { nome: '500 ml', preco: 19 }],
}

function supabaseFake() {
  const pedidoInsert = vi.fn()
  const loja = {
    status_loja: 'aberta', horario_funcionamento: null, aceita_entrega: true, aceita_retirada: true,
    pizza_calculo_preco: 'media', taxa_entrega_padrao: 0, latitude: null, longitude: null, cep: '', endereco: '',
    frete_fora_da_lista: null, frete_gratis_acima: null,
  }
  const from = vi.fn((tabela: string) => {
    switch (tabela) {
      case 'restaurantes':
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: loja, error: null }), maybeSingle: async () => ({ data: loja, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      case 'itens_cardapio':
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [ACAI], error: null }) }) }) }
      case 'clientes':
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
      case 'pedidos':
        return {
          insert: (row: Record<string, unknown>) => {
            pedidoInsert(row)
            return { select: () => ({ single: async () => ({ data: { id: 'ped-1', numero: 1 }, error: null }) }) }
          },
        }
      case 'pedido_itens':
        return { insert: async () => ({ error: null }) }
      default:
        throw new Error(`tabela inesperada: ${tabela}`)
    }
  })
  return { client: { from } as never, pedidoInsert }
}

function input(over: Partial<NovoPedidoInput> = {}): NovoPedidoInput {
  return {
    tipo: 'retirada',
    cliente: { nome: 'Fulano', telefone: '5527999990000' },
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '' },
    pagamento: 'pix',
    trocoPara: null,
    itens: [{ itemId: 'acai', quantidade: 1, complementos: [], observacao: '' }],
    ...over,
  }
}

describe('criarPedido — item com tamanhos', () => {
  it('vitrine sem tamanho é recusada (antes saía pelo preço-base: R$ 0)', async () => {
    const { client, pedidoInsert } = supabaseFake()
    await expect(criarPedido(client, 'r1', input())).rejects.toThrow(/Selecione o tamanho de "Açaí"/)
    expect(pedidoInsert).not.toHaveBeenCalled()
  })

  it('vitrine com tamanho cobra o preço do tamanho', async () => {
    const { client, pedidoInsert } = supabaseFake()
    await criarPedido(client, 'r1', input({ itens: [{ itemId: 'acai', quantidade: 2, complementos: [], observacao: '', tamanhoNome: '500 ml' }] }))
    expect(pedidoInsert.mock.calls[0][0].total).toBe(38)
  })

  it('PDV continua como antes (a regra nova é só da vitrine)', async () => {
    const { client, pedidoInsert } = supabaseFake()
    await criarPedido(client, 'r1', input({ origem: 'pdv' }))
    expect(pedidoInsert).toHaveBeenCalled()
  })
})
