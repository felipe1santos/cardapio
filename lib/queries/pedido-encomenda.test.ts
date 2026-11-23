import { afterEach, describe, expect, it, vi } from 'vitest'
import { criarPedido, type NovoPedidoInput } from './pedidos'
import { instanteDoHorario } from '@/lib/agendamento'

/** Encomendas (0250): sacola mista recusada, prazo do item, pagamento antecipado, liberar_em gravado. */
const base = { promocao_preco: null, status: 'disponivel', tipo_item: 'simples', dias_disponiveis: [0, 1, 2, 3, 4, 5, 6], item_complementos: [], tamanhos_item: [], pizza_sabores: [], grupos_cardapio: null }
const BOLO = { ...base, id: 'bolo', nome: 'Bolo de Pote', preco: 80, encomenda: true, encomenda_prazo_horas: 48, encomenda_pagamento_antecipado: false }
const TORTA = { ...base, id: 'torta', nome: 'Torta', preco: 90, encomenda: true, encomenda_prazo_horas: 24, encomenda_pagamento_antecipado: true }
const BRIGADEIRO = { ...base, id: 'brig', nome: 'Brigadeiro', preco: 3, encomenda: false, encomenda_prazo_horas: 24, encomenda_pagamento_antecipado: false }

function supabaseFake(itens: unknown[]) {
  const pedidoInsert = vi.fn()
  const loja = { status_loja: 'aberto_manual', horario_funcionamento: null, aceita_entrega: true, aceita_retirada: true, pizza_calculo_preco: 'media', frete_gratis_acima: null }
  const from = vi.fn((tabela: string) => {
    switch (tabela) {
      case 'restaurantes':
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: loja, error: null }), maybeSingle: async () => ({ data: loja, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      case 'itens_cardapio':
        return { select: () => ({ eq: () => ({ in: async () => ({ data: itens, error: null }) }) }) }
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

const input = (itens: string[], over: Partial<NovoPedidoInput> = {}): NovoPedidoInput => ({
  tipo: 'retirada',
  cliente: { nome: 'Fulano', telefone: '5527999990000' },
  endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '' },
  pagamento: 'dinheiro',
  trocoPara: null,
  itens: itens.map((itemId) => ({ itemId, quantidade: 1, complementos: [], observacao: '' })),
  ...over,
})

afterEach(() => { vi.useRealTimers() })
const relogio = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-23T13:00:00.000Z')) } // seg 10:00 SP

describe('criarPedido — encomendas (0250)', () => {
  it('sacola com encomenda + pronta entrega é recusada', async () => {
    relogio()
    const f = supabaseFake([BOLO, BRIGADEIRO])
    await expect(criarPedido(f.client, 'r1', input(['bolo', 'brig'], { agendadoPara: instanteDoHorario('2026-11-26', '15:00') }))).rejects.toThrow(/separados/)
    expect(f.pedidoInsert).not.toHaveBeenCalled()
  })

  it('encomenda sem data é recusada', async () => {
    relogio()
    const f = supabaseFake([BOLO])
    await expect(criarPedido(f.client, 'r1', input(['bolo']))).rejects.toThrow(/data/)
  })

  it('antes do prazo do item é recusada (mesmo com o agendamento da loja desligado)', async () => {
    relogio()
    const f = supabaseFake([BOLO])
    await expect(criarPedido(f.client, 'r1', input(['bolo'], { agendadoPara: instanteDoHorario('2026-11-24', '15:00') }))).rejects.toThrow(/antecedência/)
  })

  it('dentro do prazo grava encomenda, agendado_para e liberar_em = agora (entra no Kanban na hora, pedido do dono 23/11)', async () => {
    relogio()
    const f = supabaseFake([BOLO])
    const quando = instanteDoHorario('2026-11-26', '15:00')
    await criarPedido(f.client, 'r1', input(['bolo'], { agendadoPara: quando }))
    expect(f.pedidoInsert).toHaveBeenCalledWith(expect.objectContaining({ encomenda: true, agendado_para: quando, liberar_em: '2026-11-23T13:00:00.000Z' }))
    // Aceita automaticamente (pedido do dono 23/11): nasce "em preparo", com a etapa carimbada.
    expect(f.pedidoInsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'preparando', preparando_em: '2026-11-23T13:00:00.000Z' }))
  })

  it('pagamento antecipado: dinheiro recusado, Pix online aceito', async () => {
    relogio()
    const quando = instanteDoHorario('2026-11-26', '15:00')
    const a = supabaseFake([TORTA])
    await expect(criarPedido(a.client, 'r1', input(['torta'], { agendadoPara: quando }))).rejects.toThrow(/antecipado/)
    const b = supabaseFake([TORTA])
    await criarPedido(b.client, 'r1', input(['torta'], { agendadoPara: quando, pagamento: 'pix', pixOnline: true }))
    // Pix online: espera o pagamento como qualquer pedido; a confirmação é que aceita (lib/pagamentos/pix-online.ts).
    expect(b.pedidoInsert).toHaveBeenCalledWith(expect.objectContaining({ encomenda: true, status: 'aguardando_pagamento' }))
  })

  it('pedido comum segue igual (sem encomenda no insert); PDV pode vender o item de encomenda junto', async () => {
    relogio()
    const a = supabaseFake([BRIGADEIRO])
    await criarPedido(a.client, 'r1', input(['brig']))
    expect(a.pedidoInsert.mock.calls[0][0]).not.toHaveProperty('encomenda')
    const b = supabaseFake([BOLO, BRIGADEIRO])
    await criarPedido(b.client, 'r1', input(['bolo', 'brig'], { origem: 'pdv' }))
    expect(b.pedidoInsert).toHaveBeenCalled()
  })
})
