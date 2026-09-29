import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

const ALMOCO = {
  id: 'pf', nome: 'Prato feito', preco: 25, promocao_preco: null, status: 'disponivel', tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], tamanhos_item: [], pizza_sabores: [],
  grupos_cardapio: { horario_ativo_inicio: '11:00:00', horario_ativo_fim: '15:00:00' },
}

function supabaseFake() {
  const pedidoInsert = vi.fn()
  const loja = {
    status_loja: 'aberto_manual', horario_funcionamento: null, aceita_entrega: true, aceita_retirada: true,
    pizza_calculo_preco: 'media', frete_gratis_acima: null,
  }
  const from = vi.fn((tabela: string) => {
    switch (tabela) {
      case 'restaurantes':
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: loja, error: null }), maybeSingle: async () => ({ data: loja, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      case 'itens_cardapio':
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [ALMOCO], error: null }) }) }) }
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

const input = (over: Partial<NovoPedidoInput> = {}): NovoPedidoInput => ({
  tipo: 'retirada',
  cliente: { nome: 'Fulano', telefone: '5527999990000' },
  endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '' },
  pagamento: 'pix',
  trocoPara: null,
  itens: [{ itemId: 'pf', quantidade: 1, complementos: [], observacao: '' }],
  ...over,
})

afterEach(() => { vi.useRealTimers() })

describe('criarPedido — categoria com horário (Almoço 11h–15h)', () => {
  it('vitrine às 15h05 é recusada', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T18:05:00.000Z')) // 15:05 em São Paulo
    const { client, pedidoInsert } = supabaseFake()
    await expect(criarPedido(client, 'r1', input())).rejects.toThrow(/outro horário/)
    expect(pedidoInsert).not.toHaveBeenCalled()
  })

  it('vitrine às 12h passa; PDV fora do horário passa (registra o que aconteceu no balcão)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T15:00:00.000Z')) // 12:00
    const a = supabaseFake()
    await criarPedido(a.client, 'r1', input())
    expect(a.pedidoInsert).toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-09-29T18:05:00.000Z'))
    const b = supabaseFake()
    await criarPedido(b.client, 'r1', input({ origem: 'pdv' }))
    expect(b.pedidoInsert).toHaveBeenCalled()
  })
})
