import { describe, expect, it } from 'vitest'
import { clientePodeSolicitar, pedidoEditavel } from './pedido-editavel'

describe('pedidoEditavel (Q2/Q12/Q17)', () => {
  it('recebido, preparando e pronto sem despacho: editável (agendado também)', () => {
    for (const status of ['recebido', 'preparando', 'pronto']) expect(pedidoEditavel({ status })).toEqual({ ok: true })
  })
  it('em rota, motoboy atribuído, "saiu p/ entrega" ou corrida Lalamove chamada: despachado', () => {
    expect(pedidoEditavel({ status: 'em_rota' })).toMatchObject({ ok: false, motivo: 'despachado' })
    expect(pedidoEditavel({ status: 'pronto', entregadorId: 'm1' })).toMatchObject({ ok: false, motivo: 'despachado' })
    expect(pedidoEditavel({ status: 'pronto', saiuParaEntregaEm: '2026-10-18T20:00:00Z' })).toMatchObject({ ok: false, motivo: 'despachado' })
    expect(pedidoEditavel({ status: 'pronto' }, true)).toMatchObject({ ok: false, motivo: 'despachado', texto: expect.stringContaining('já saiu para entrega') })
  })
  it('entregue, cancelado, aguardando pagamento, mesa e app externo', () => {
    expect(pedidoEditavel({ status: 'entregue' })).toMatchObject({ ok: false, motivo: 'entregue' })
    expect(pedidoEditavel({ status: 'cancelado' })).toMatchObject({ ok: false, motivo: 'cancelado' })
    expect(pedidoEditavel({ status: 'aguardando_pagamento' })).toMatchObject({ ok: false, motivo: 'aguardando_pagamento' })
    expect(pedidoEditavel({ status: 'recebido', canal: 'mesa' })).toMatchObject({ ok: false, motivo: 'mesa' })
    expect(pedidoEditavel({ status: 'recebido', origemCanal: 'ifood' })).toMatchObject({ ok: false, motivo: 'app_externo', texto: expect.stringContaining('app de origem') })
  })
  it('cliente pode solicitar em aguardando pagamento (só cancelar/pagamento), e nunca depois do despacho', () => {
    expect(clientePodeSolicitar({ status: 'aguardando_pagamento' })).toEqual({ ok: true })
    expect(clientePodeSolicitar({ status: 'em_rota' })).toMatchObject({ ok: false, motivo: 'despachado' })
  })
})
