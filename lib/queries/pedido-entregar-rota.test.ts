import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { entregarPedidoEmRota } from './pedidos'

function banco(status: string) {
  const pedido = { id: 'p1', status }
  const from = () => {
    const filtros: [string, unknown][] = []
    let patch: Record<string, unknown> = {}
    const b: Record<string, unknown> = {
      update: (p: Record<string, unknown>) => { patch = p; return b },
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return b },
      select: async () => {
        const bate = filtros.every(([k, v]) => (pedido as Record<string, unknown>)[k] === v)
        if (bate) Object.assign(pedido, patch)
        return { data: bate ? [{ id: 'p1' }] : [], error: null }
      },
    }
    return b
  }
  return { cliente: { from } as unknown as SupabaseClient, pedido }
}

describe('entregarPedidoEmRota (botão Entregue da Logística)', () => {
  it('em rota: marca entregue e avisa', async () => {
    const { cliente, pedido } = banco('em_rota')
    expect(await entregarPedidoEmRota(cliente, 'p1')).toBe(true)
    expect(pedido.status).toBe('entregue')
  })
  it('entregador já marcou: não avança de novo (sem 2º WhatsApp)', async () => {
    const { cliente } = banco('entregue')
    expect(await entregarPedidoEmRota(cliente, 'p1')).toBe(false)
  })
})
