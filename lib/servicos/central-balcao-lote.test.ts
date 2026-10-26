import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listarCentralBalcao } from './conta-presencial'

/**
 * Achado #9 da auditoria (25/10): a Central do balcão chamava a RPC `comanda_totais` uma vez POR comanda (até 200) a
 * cada recarga (evento e relógio). Agora: uma chamada em lote (`comanda_totais_lote`, 0226); se a função ainda não
 * existir no banco, volta ao jeito antigo.
 */

const COMANDAS = [
  { id: 'c1', senha: 1, cliente_nome: 'Ana', cliente_telefone: null, entrega: false, status: 'aberta', aberta_em: '2026-10-26T10:00:00Z', fechada_em: null },
  { id: 'c2', senha: 2, cliente_nome: 'Bia', cliente_telefone: null, entrega: true, status: 'aberta', aberta_em: '2026-10-26T10:05:00Z', fechada_em: null },
  { id: 'c3', senha: 3, cliente_nome: 'Caio', cliente_telefone: null, entrega: false, status: 'aberta', aberta_em: '2026-10-26T10:10:00Z', fechada_em: null },
]

function supabaseFalso(loteExiste: boolean) {
  const rpc = vi.fn(async (nome: string, args: Record<string, unknown>) => {
    if (nome === 'comanda_totais_lote') {
      if (!loteExiste) return { data: null, error: { code: 'PGRST202', message: 'function not found' } }
      // Ordem trocada de propósito: o mapeamento tem que ser por id.
      return { data: (args.p_comandas as string[]).slice().reverse().map((id) => ({ comanda_id: id, total: Number(id.slice(1)) * 10, pago: 5, restante: Number(id.slice(1)) * 10 - 5, subtotal: 0, taxa_servico: 0, desconto: 0 })), error: null }
    }
    const id = args.p_comanda as string
    return { data: [{ total: Number(id.slice(1)) * 10, pago: 5, restante: Number(id.slice(1)) * 10 - 5 }], error: null }
  })
  const resposta = (data: unknown, extra: Record<string, unknown> = {}) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'gte', 'in', 'is', 'order', 'limit']) q[m] = () => q
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null, ...extra }).then(ok)
    return q
  }
  const from = vi.fn((tabela: string) => {
    if (tabela === 'comandas') return resposta(COMANDAS, { count: 3 })
    return resposta([])
  })
  return { admin: { from, rpc } as unknown as SupabaseClient, rpc }
}

describe('listarCentralBalcao — totais em lote', () => {
  it('3 comandas: UMA chamada ao banco, totais certos por comanda', async () => {
    const { admin, rpc } = supabaseFalso(true)
    const r = await listarCentralBalcao(admin, 'loja', 'abertas')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('comanda_totais_lote', { p_comandas: ['c1', 'c2', 'c3'] })
    expect(r.linhas.map((l) => [l.id, l.total])).toEqual([['c1', 10], ['c2', 20], ['c3', 30]])
  })

  it('função em lote ainda não aplicada no banco: volta ao cálculo por comanda', async () => {
    const { admin, rpc } = supabaseFalso(false)
    const r = await listarCentralBalcao(admin, 'loja', 'abertas')
    expect(rpc.mock.calls.filter(([n]) => n === 'comanda_totais')).toHaveLength(3)
    expect(r.linhas.map((l) => l.total)).toEqual([10, 20, 30])
  })
})
