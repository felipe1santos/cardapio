import { describe, expect, it } from 'vitest'
import { acordaAEspera } from './despertador'

/**
 * Egress (26/10): toda mudança num pedido da loja acordava a espera longa do Assistente (~15 consultas por acordada),
 * inclusive coordenadas, motoboy e entregue — que nunca viram ficha nem mexem no alarme (que conta os "recebido").
 * A fila de impressão inclui pronto não impresso e reimpressão pedida: esses continuam acordando.
 */

const upd = (n: Record<string, unknown>) => ({ eventType: 'UPDATE', new: { id: 'p', restaurante_id: 'loja', ...n } })

describe('acordaAEspera', () => {
  it('pedido novo acorda', () => {
    expect(acordaAEspera({ eventType: 'INSERT', new: { status: 'recebido' } })).toBe(true)
  })

  it('aceite, pronto (pode ter pulado etapa) e cancelado acordam', () => {
    for (const status of ['recebido', 'preparando', 'pronto', 'cancelado', 'aguardando_pagamento']) expect(acordaAEspera(upd({ status }))).toBe(true)
  })

  it('em rota e entregue não acordam (não imprimem e não mexem no alarme)', () => {
    expect(acordaAEspera(upd({ status: 'em_rota' }))).toBe(false)
    expect(acordaAEspera(upd({ status: 'entregue' }))).toBe(false)
  })

  it('reimpressão pedida acorda em qualquer status', () => {
    expect(acordaAEspera(upd({ status: 'entregue', reimprimir: true }))).toBe(true)
    expect(acordaAEspera(upd({ status: 'em_rota', reimprimir: true }))).toBe(true)
  })

  it('evento sem os dados (DELETE ou sem status) acorda por segurança', () => {
    expect(acordaAEspera({ eventType: 'DELETE', new: {} })).toBe(true)
    expect(acordaAEspera({ eventType: 'UPDATE', new: {} })).toBe(true)
  })
})
