import { describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

// Guarda server-authoritative da criação de pedido (migration 0054): quem decide a
// taxa é `resolverFrete`, tanto no pedido da vitrine quanto no do PDV. Nenhum dos
// dois pode furar o bloqueio nem inventar a taxa que veio no payload.

const ITEM = {
  id: 'item-1',
  nome: 'X-Burger',
  preco: 20,
  promocao_preco: null,
  status: 'disponivel',
  tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6],
  item_complementos: [],
  tamanhos_item: [],
  pizza_sabores: [],
}

/**
 * Supabase falso roteado por tabela, só com o que `criarPedido` toca no caminho
 * feliz (sem cupom, sem prêmio, sem pizza). Captura o insert em `pedidos`.
 */
function supabaseFake(opts: {
  foraDaLista: string | null
  bairros: { bairro: string; taxa: number }[]
  raios?: { ate_km: number; taxa: number }[]
  taxaPadrao?: number
}) {
  const pedidoInsert = vi.fn()
  const loja = {
    status_loja: 'aberta',
    horario_funcionamento: null,
    aceita_entrega: true,
    aceita_retirada: true,
    pizza_calculo_preco: 'media',
    taxa_entrega_padrao: opts.taxaPadrao ?? 7,
    latitude: -20.33,
    longitude: -40.29,
    cep: '29100500',
    endereco: 'Rua da Loja, 10',
    frete_fora_da_lista: opts.foraDaLista,
    frete_gratis_acima: null,
  }

  const from = vi.fn((tabela: string) => {
    switch (tabela) {
      case 'restaurantes':
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: loja, error: null }),
              maybeSingle: async () => ({ data: loja, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      case 'itens_cardapio':
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [ITEM], error: null }) }) }) }
      case 'taxas_entrega_bairro':
        return { select: () => ({ eq: async () => ({ data: opts.bairros, error: null }) }) }
      case 'taxas_entrega_raio':
        return { select: () => ({ eq: () => ({ order: async () => ({ data: opts.raios ?? [], error: null }) }) }) }
      case 'clientes':
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }
      case 'pedidos':
        return {
          insert: (row: Record<string, unknown>) => {
            pedidoInsert(row)
            return { select: () => ({ single: async () => ({ data: { id: 'ped-1', numero: 42 }, error: null }) }) }
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
    tipo: 'entrega',
    cliente: { nome: 'Fulano', telefone: '5527999990000' },
    endereco: { rua: 'Rua A', numero: '10', complemento: '', bairro: 'Bairro Novo', cep: '', cidade: 'Vila Velha' },
    pagamento: 'dinheiro',
    trocoPara: null,
    // Palpite do client: nunca deve ser usado como taxa real.
    taxaEntrega: 99,
    itens: [{ itemId: 'item-1', quantidade: 1, complementos: [], observacao: '' }],
    ...over,
  }
}

describe('criarPedido — bairro fora da tabela de taxas', () => {
  describe('pedido da vitrine (origem cardapio)', () => {
    it("modo 'bloquear': recusa o pedido com a mensagem da loja", async () => {
      const { client, pedidoInsert } = supabaseFake({ foraDaLista: 'bloquear', bairros: [{ bairro: 'Centro', taxa: 5 }] })
      await expect(criarPedido(client, 'r1', input())).rejects.toThrow(/não entrega nesse bairro/i)
      expect(pedidoInsert).not.toHaveBeenCalled()
    })

    it("modo 'taxa_padrao': cria o pedido cobrando a taxa padrão (não a do payload)", async () => {
      const { client, pedidoInsert } = supabaseFake({ foraDaLista: 'taxa_padrao', bairros: [{ bairro: 'Centro', taxa: 5 }] })
      const r = await criarPedido(client, 'r1', input())
      expect(r).toEqual({ id: 'ped-1', numero: 42 })
      const row = pedidoInsert.mock.calls[0][0]
      expect(row.taxa_entrega).toBe(7)
      expect(row.total).toBe(27) // subtotal 20 + taxa 7
    })

    it("modo 'taxa_padrao': bairro cadastrado continua pagando a taxa específica dele", async () => {
      const { client, pedidoInsert } = supabaseFake({ foraDaLista: 'taxa_padrao', bairros: [{ bairro: 'Centro', taxa: 5 }] })
      await criarPedido(client, 'r1', input({ endereco: { rua: 'Rua A', numero: '10', complemento: '', bairro: 'centro', cep: '', cidade: 'Vila Velha' } }))
      expect(pedidoInsert.mock.calls[0][0].taxa_entrega).toBe(5)
    })

    it('coluna NULL (loja anterior à migration) mantém o bloqueio de hoje', async () => {
      const { client } = supabaseFake({ foraDaLista: null, bairros: [{ bairro: 'Centro', taxa: 5 }] })
      await expect(criarPedido(client, 'r1', input())).rejects.toThrow(/não entrega nesse bairro/i)
    })

    it("loja com raio: modo 'taxa_padrao' NÃO destrava endereço que não dá pra localizar", async () => {
      const { client, pedidoInsert } = supabaseFake({
        foraDaLista: 'taxa_padrao',
        bairros: [{ bairro: 'Centro', taxa: 5 }],
        raios: [{ ate_km: 5, taxa: 6 }],
      })
      await expect(criarPedido(client, 'r1', input())).rejects.toThrow(/localizar esse endereço/i)
      expect(pedidoInsert).not.toHaveBeenCalled()
    })

    it('retirada não passa pela regra de bairro nem cobra taxa', async () => {
      const { client, pedidoInsert } = supabaseFake({ foraDaLista: 'bloquear', bairros: [{ bairro: 'Centro', taxa: 5 }] })
      await criarPedido(client, 'r1', input({ tipo: 'retirada' }))
      expect(pedidoInsert.mock.calls[0][0].taxa_entrega).toBe(0)
    })
  })

  describe('pedido do PDV (origem pdv)', () => {
    it("modo 'bloquear': o atendente também é barrado — mesma regra do servidor", async () => {
      const { client, pedidoInsert } = supabaseFake({ foraDaLista: 'bloquear', bairros: [{ bairro: 'Centro', taxa: 5 }] })
      await expect(criarPedido(client, 'r1', input({ origem: 'pdv' }))).rejects.toThrow(/não entrega nesse bairro/i)
      expect(pedidoInsert).not.toHaveBeenCalled()
    })

    it("modo 'taxa_padrao': o atendente consegue lançar a entrega pela taxa padrão", async () => {
      const { client, pedidoInsert } = supabaseFake({ foraDaLista: 'taxa_padrao', bairros: [{ bairro: 'Centro', taxa: 5 }] })
      await criarPedido(client, 'r1', input({ origem: 'pdv' }))
      const row = pedidoInsert.mock.calls[0][0]
      expect(row.origem).toBe('pdv')
      expect(row.taxa_entrega).toBe(7)
    })

    it("loja com raio: modo 'taxa_padrao' também não destrava o PDV sem geocode", async () => {
      const { client } = supabaseFake({
        foraDaLista: 'taxa_padrao',
        bairros: [{ bairro: 'Centro', taxa: 5 }],
        raios: [{ ate_km: 5, taxa: 6 }],
      })
      await expect(criarPedido(client, 'r1', input({ origem: 'pdv' }))).rejects.toThrow(/localizar esse endereço/i)
    })
  })
})
