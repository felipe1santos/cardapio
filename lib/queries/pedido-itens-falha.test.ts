import { describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'

/**
 * Achado #1/#2 da auditoria (25/10): pedido e itens são dois INSERTs. Se o dos itens falhava, o pedido ficava gravado
 * SEM itens, com prêmio/cupom/cashback consumidos — e o reenvio com a mesma chave recebia esse pedido vazio como
 * sucesso (no Pix online, chegava a cobrar). Agora: apaga o pedido recém-criado e devolve as reservas.
 */

const ITEM = {
  id: 'item-1', nome: 'X-Burger', preco: 30, promocao_preco: null, status: 'disponivel', tipo_item: 'simples',
  dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], tamanhos_item: [], pizza_sabores: [],
}

function supabaseFake(itensFalham: boolean) {
  const recompensaUpdates: Record<string, unknown>[] = []
  const apagados: unknown[] = []
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
      case 'clientes': {
        const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { verificado_em: '2026-09-01T00:00:00Z' }, error: null }) }
        return b
      }
      case 'pedidos':
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'p', numero: 1 }, error: null }) }) }),
          delete: () => ({ eq: async (_c: string, id: unknown) => { apagados.push(id); return { error: null } } }),
        }
      case 'pedido_itens':
        return { insert: async () => ({ error: itensFalham ? { message: 'falha simulada ao gravar itens' } : null }) }
      default:
        throw new Error(`tabela inesperada: ${tabela}`)
    }
  })
  return { client: { from } as never, recompensaUpdates, apagados }
}

const input: NovoPedidoInput = {
  tipo: 'retirada',
  cliente: { nome: 'Fulano', telefone: '5527999990000' },
  endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '' },
  pagamento: 'dinheiro',
  trocoPara: 50,
  recompensaId: 'rec-1',
  clienteToken: 'tok-dono',
  itens: [{ itemId: 'item-1', quantidade: 1, complementos: [], observacao: '' }],
}

describe('criarPedido — falha ao gravar os itens', () => {
  it('apaga o pedido recém-criado (não sobra pedido vazio) e devolve o prêmio', async () => {
    const { client, recompensaUpdates, apagados } = supabaseFake(true)
    await expect(criarPedido(client, 'r1', input)).rejects.toBeTruthy()
    expect(apagados).toEqual(['p'])
    expect(recompensaUpdates.map((u) => u.status).filter(Boolean)).toEqual(['resgatado', 'disponivel'])
  })

  it('itens gravados: nada é apagado nem devolvido', async () => {
    const { client, recompensaUpdates, apagados } = supabaseFake(false)
    await criarPedido(client, 'r1', input)
    expect(apagados).toEqual([])
    expect(recompensaUpdates.map((u) => u.status).filter(Boolean)).toEqual(['resgatado'])
  })
})
