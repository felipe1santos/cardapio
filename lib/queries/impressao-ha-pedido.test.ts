import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { haPedidoParaImprimir } from './impressao'

/** Re-busca do aviso (29/10): conferência só de leitura, com a mesma regra da fila e do corte da transferência. */
function adminFalso(ids: string[], criados: string[]) {
  const rpc = vi.fn(async () => ({ data: ids, error: null }))
  const from = vi.fn(() => {
    const q = { select: () => q, eq: () => q, in: async () => ({ data: criados.map((c) => ({ criado_em: c })), error: null }) }
    return q
  })
  return { admin: { rpc, from } as unknown as SupabaseClient, rpc, from }
}

describe('haPedidoParaImprimir', () => {
  it('nada elegível → false, sem ler pedidos; nunca reserva', async () => {
    const { admin, rpc, from } = adminFalso([], [])
    expect(await haPedidoParaImprimir(admin, 'loja')).toBe(false)
    expect(rpc).toHaveBeenCalledWith('impressao_elegiveis', { p_restaurante: 'loja' })
    expect(rpc).not.toHaveBeenCalledWith('impressao_reservar', expect.anything())
    expect(from).not.toHaveBeenCalled()
  })

  it('elegível e sem transferência recente → true, uma consulta só', async () => {
    const { admin, from } = adminFalso(['p1'], [])
    expect(await haPedidoParaImprimir(admin, 'loja', null)).toBe(true)
    expect(from).not.toHaveBeenCalled()
  })

  it('na janela da transferência: pedido anterior ao corte não conta; posterior conta', async () => {
    const corte = new Date(Date.now() - 5_000).toISOString()
    const antes = new Date(Date.now() - 60_000).toISOString()
    expect(await haPedidoParaImprimir(adminFalso(['p1'], [antes]).admin, 'loja', corte)).toBe(false)
    expect(await haPedidoParaImprimir(adminFalso(['p1'], [new Date().toISOString()]).admin, 'loja', corte)).toBe(true)
  })
})
