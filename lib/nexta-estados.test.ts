import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aplicarEventoNexta, type EventoNexta } from './nexta-estados'
import type { NextaEntregaLinha } from './queries/nexta'

vi.mock('./queries/nexta', () => ({
  atualizarNextaEntrega: vi.fn(async () => {}),
  registrarEventoNextaEntrega: vi.fn(async () => {}),
  desvincularEntregaDoPedido: vi.fn(async () => {}),
}))
vi.mock('./pedido-eventos', () => ({ aplicarEfeitosStatusPedido: vi.fn(async () => {}) }))

const { atualizarNextaEntrega, registrarEventoNextaEntrega, desvincularEntregaDoPedido } = await import('./queries/nexta')
const { aplicarEfeitosStatusPedido } = await import('./pedido-eventos')

/** Guarda o update de `pedidos` e decide se ele "pegou" (simula o UPDATE condicional). */
let updatePedido: { status?: string; statusPermitidos?: string[] }
let pedidoAfetado = true

function fakeAdmin(): SupabaseClient {
  const pedidos = {
    update(row: { status?: string }) {
      updatePedido = { status: row.status }
      return {
        eq() {
          return this
        },
        in(_coluna: string, valores: string[]) {
          updatePedido.statusPermitidos = valores
          return this
        },
        select: async () => ({ data: pedidoAfetado ? [{ id: 'pedido-1' }] : [], error: null }),
      }
    },
  }
  return { from: (tabela: string) => (tabela === 'pedidos' ? pedidos : {}) } as unknown as SupabaseClient
}

const entrega = (over: Partial<NextaEntregaLinha> = {}): NextaEntregaLinha => ({
  id: 'order-1',
  restauranteId: 'r1',
  pedidoId: 'pedido-1',
  deliveryId: 'd1',
  status: 'ACCEPTED',
  preco: 9.4,
  etaColeta: null,
  etaEntrega: null,
  entregadorNome: '',
  entregadorTelefone: '',
  entregadorFotoUrl: '',
  trackingUrl: null,
  rejeicaoMotivo: null,
  problema: null,
  cancelAdditionalCharges: null,
  criadoEm: '2026-07-15T18:00:00Z',
  atualizadoEm: '2026-07-15T18:00:00Z',
  ...over,
})

const ev = (tipo: string, extra: Partial<EventoNexta> = {}): EventoNexta => ({ orderId: 'order-1', event: { type: tipo }, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  updatePedido = {}
  pedidoAfetado = true
})

describe('transições do pedido', () => {
  it('ORDER_PICKED coloca o pedido em rota e avisa o cliente', async () => {
    const r = await aplicarEventoNexta(fakeAdmin(), entrega(), ev('ORDER_PICKED'))
    expect(updatePedido.status).toBe('em_rota')
    expect(updatePedido.statusPermitidos).toEqual(['pronto'])
    expect(aplicarEfeitosStatusPedido).toHaveBeenCalledWith(expect.anything(), 'pedido-1', 'em_rota')
    expect(r.statusPedido).toBe('em_rota')
  })

  it('DELIVERY_FINISHED entrega o pedido', async () => {
    const r = await aplicarEventoNexta(fakeAdmin(), entrega({ status: 'ORDER_DELIVERED' }), ev('DELIVERY_FINISHED'))
    expect(updatePedido.status).toBe('entregue')
    expect(updatePedido.statusPermitidos).toEqual(['pronto', 'em_rota'])
    expect(aplicarEfeitosStatusPedido).toHaveBeenCalledWith(expect.anything(), 'pedido-1', 'entregue')
    expect(r.statusPedido).toBe('entregue')
  })

  it('CANCELLED devolve o pedido para a fila de despacho, sem notificar o cliente', async () => {
    await aplicarEventoNexta(fakeAdmin(), entrega({ status: 'PICKUP_ONGOING' }), ev('CANCELLED'))
    expect(updatePedido.status).toBe('pronto')
    expect(updatePedido.statusPermitidos).toEqual(['em_rota'])
    // "Voltou pra fila" não é notícia pro cliente — ele já foi avisado que estava pronto.
    expect(aplicarEfeitosStatusPedido).not.toHaveBeenCalled()
  })

  it('ACCEPTED não mexe no status do pedido', async () => {
    const r = await aplicarEventoNexta(fakeAdmin(), entrega({ status: 'PENDING' }), ev('ACCEPTED'))
    expect(updatePedido.status).toBeUndefined()
    expect(r.statusPedido).toBeNull()
    expect(r.aplicado).toBe(true)
  })

  it('não notifica quando o UPDATE condicional não pega (pedido já estava noutro estado)', async () => {
    pedidoAfetado = false
    const r = await aplicarEventoNexta(fakeAdmin(), entrega(), ev('ORDER_PICKED'))
    expect(aplicarEfeitosStatusPedido).not.toHaveBeenCalled()
    expect(r.statusPedido).toBeNull()
    expect(r.aplicado).toBe(true)
  })

  it('efeito colateral que falha não derruba a transição já aplicada', async () => {
    vi.mocked(aplicarEfeitosStatusPedido).mockRejectedValueOnce(new Error('whatsapp fora'))
    const r = await aplicarEventoNexta(fakeAdmin(), entrega(), ev('ORDER_PICKED'))
    expect(r.statusPedido).toBe('em_rota')
  })
})

describe('idempotência', () => {
  it('evento repetido atualiza o espelho mas não re-executa a transição', async () => {
    const r = await aplicarEventoNexta(fakeAdmin(), entrega({ status: 'ORDER_PICKED' }), ev('ORDER_PICKED'))
    expect(updatePedido.status).toBeUndefined()
    expect(aplicarEfeitosStatusPedido).not.toHaveBeenCalled()
    expect(r.aplicado).toBe(false)
  })

  it('DELIVERY_ONGOING repetido atualiza ETA e geolocalização sem transicionar', async () => {
    await aplicarEventoNexta(
      fakeAdmin(),
      entrega({ status: 'DELIVERY_ONGOING' }),
      ev('DELIVERY_ONGOING', { eta: { deliveryEtaDatetime: '2026-07-15T19:00:00Z' } })
    )
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).toMatchObject({ etaEntrega: '2026-07-15T19:00:00.000Z' })
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).not.toHaveProperty('status')
    expect(updatePedido.status).toBeUndefined()
  })

  it('registra todo evento no histórico, mesmo repetido', async () => {
    await aplicarEventoNexta(fakeAdmin(), entrega({ status: 'ACCEPTED' }), ev('ACCEPTED'))
    expect(registrarEventoNextaEntrega).toHaveBeenCalledTimes(1)
  })

  it('não registra no histórico quando é reconciliação (não é webhook)', async () => {
    await aplicarEventoNexta(fakeAdmin(), entrega(), ev('ORDER_PICKED'), { registrarBruto: false })
    expect(registrarEventoNextaEntrega).not.toHaveBeenCalled()
  })
})

describe('desvinculação do pedido', () => {
  it.each(['REJECTED', 'CANCELLED', 'ORDER_DELIVERED', 'DELIVERY_FINISHED', 'RETURNED_TO_MERCHANT'])(
    '%s solta o pedido da entrega (libera novo despacho)',
    async (tipo) => {
      await aplicarEventoNexta(fakeAdmin(), entrega({ status: 'PICKUP_ONGOING' }), ev(tipo))
      expect(desvincularEntregaDoPedido).toHaveBeenCalledWith(expect.anything(), 'pedido-1', 'order-1')
    }
  )

  it('evento intermediário mantém o pedido vinculado', async () => {
    await aplicarEventoNexta(fakeAdmin(), entrega(), ev('PICKUP_ONGOING'))
    expect(desvincularEntregaDoPedido).not.toHaveBeenCalled()
  })
})

describe('dados espelhados', () => {
  it('grava entregador, tracking e preço vindos do evento', async () => {
    await aplicarEventoNexta(
      fakeAdmin(),
      entrega(),
      ev('PICKUP_ONGOING', {
        deliveryPerson: { name: 'Joao', phone: '11999998888', pictureURL: 'https://x/f.jpg' },
        deliveryPrice: { price: { value: 12.5 } },
        externalTrackingURL: 'https://track/1',
      })
    )
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).toMatchObject({
      status: 'PICKUP_ONGOING',
      entregadorNome: 'Joao',
      entregadorTelefone: '11999998888',
      entregadorFotoUrl: 'https://x/f.jpg',
      preco: 12.5,
      trackingUrl: 'https://track/1',
    })
  })

  it('guarda o motivo da recusa', async () => {
    await aplicarEventoNexta(
      fakeAdmin(),
      entrega({ status: 'PENDING' }),
      { orderId: 'order-1', event: { type: 'REJECTED', rejectionInfo: { reason: 'NO_DELIVERYPERSON_AVAILABLE' } } }
    )
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).toMatchObject({ rejeicaoMotivo: 'NO_DELIVERYPERSON_AVAILABLE' })
  })

  // O Nexta manda `0` quando não há ETA. `new Date('0')` devolve o ano 2000 em vez de
  // NaN, então checar só "parseou?" gravaria uma ETA-lixo na tela do lojista.
  it.each(['0', 0, '', 'sem eta', null])('ignora ETA invalida (%s)', async (valor) => {
    await aplicarEventoNexta(
      fakeAdmin(),
      entrega(),
      ev('PICKUP_ONGOING', { eta: { pickupEtaDatetime: valor as unknown as string } })
    )
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).not.toHaveProperty('etaColeta')
  })

  it('aceita ETA ISO de verdade', async () => {
    await aplicarEventoNexta(fakeAdmin(), entrega(), ev('PICKUP_ONGOING', { eta: { pickupEtaDatetime: '2026-07-15T18:07:33Z' } }))
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).toMatchObject({ etaColeta: '2026-07-15T18:07:33.000Z' })
  })

  it('limpa o problema quando o evento não traz nenhum', async () => {
    await aplicarEventoNexta(fakeAdmin(), entrega(), ev('PICKUP_ONGOING'))
    expect(vi.mocked(atualizarNextaEntrega).mock.calls[0][2]).toMatchObject({ problema: null })
  })
})

describe('tolerância a enum novo', () => {
  it('evento desconhecido vira status novo sem quebrar nem mexer no pedido', async () => {
    const r = await aplicarEventoNexta(fakeAdmin(), entrega(), ev('ALGUM_EVENTO_NOVO'))
    expect(r.aplicado).toBe(true)
    expect(r.statusNovo).toBe('ALGUM_EVENTO_NOVO')
    expect(updatePedido.status).toBeUndefined()
  })

  it('evento sem tipo é ignorado', async () => {
    const r = await aplicarEventoNexta(fakeAdmin(), entrega(), { orderId: 'order-1' })
    expect(r.aplicado).toBe(false)
    expect(atualizarNextaEntrega).not.toHaveBeenCalled()
  })
})
