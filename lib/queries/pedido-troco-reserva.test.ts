import { describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

const ITEM = {
  id: 'item-1', nome: 'X-Burger', preco: 30, promocao_preco: null, status: 'disponivel', tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], tamanhos_item: [], pizza_sabores: [],
}

/** Supabase falso com um prêmio de fidelidade de R$ 5 disponível para o cliente. */
function supabaseFake() {
  const recompensaUpdates: Record<string, unknown>[] = []
  const pedidoInsert = vi.fn()
  const loja = {
    status_loja: 'aberta', horario_funcionamento: null, aceita_entrega: true, aceita_retirada: true,
    pizza_calculo_preco: 'media', taxa_entrega_padrao: 0, latitude: null, longitude: null, cep: '', endereco: '',
    frete_fora_da_lista: null, frete_gratis_acima: null,
  }
  const recompensa = {
    id: 'rec-1', cliente_telefone: '5527999990000',
    campanha: { premio_tipo: 'desconto_valor', premio_valor: 5, premio_item_id: null, dias_semana_resgate: [] },
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
      case 'fidelidade_recompensas': {
        const sel = { eq: () => sel, maybeSingle: async () => ({ data: recompensa, error: null }) }
        return {
          select: () => sel,
          update: (row: Record<string, unknown>) => {
            recompensaUpdates.push(row)
            const upd = { eq: () => upd, select: async () => ({ data: [{ id: 'rec-1' }], error: null }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) }
            return upd
          },
        }
      }
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
  return { client: { from } as never, recompensaUpdates, pedidoInsert }
}

function input(over: Partial<NovoPedidoInput> = {}): NovoPedidoInput {
  return {
    tipo: 'retirada',
    cliente: { nome: 'Fulano', telefone: '5527999990000' },
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '' },
    pagamento: 'dinheiro',
    trocoPara: 20, // menor que o total (30 - 5 = 25)
    recompensaId: 'rec-1',
    itens: [{ itemId: 'item-1', quantidade: 1, complementos: [], observacao: '' }],
    ...over,
  }
}

describe('criarPedido — troco recusado depois de reservar o prêmio', () => {
  it('devolve o prêmio ao cliente (antes ficava "resgatado" para sempre)', async () => {
    const { client, recompensaUpdates, pedidoInsert } = supabaseFake()
    await expect(criarPedido(client, 'r1', input())).rejects.toThrow(/troco/i)
    expect(pedidoInsert).not.toHaveBeenCalled()
    expect(recompensaUpdates.map((u) => u.status)).toEqual(['resgatado', 'disponivel'])
  })

  it('troco suficiente: prêmio fica resgatado e o pedido nasce', async () => {
    const { client, recompensaUpdates, pedidoInsert } = supabaseFake()
    await criarPedido(client, 'r1', input({ trocoPara: 50 }))
    expect(pedidoInsert).toHaveBeenCalled()
    expect(recompensaUpdates[0].status).toBe('resgatado')
    expect(recompensaUpdates.some((u) => u.status === 'disponivel')).toBe(false)
  })
})
