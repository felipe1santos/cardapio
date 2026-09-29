import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { carregarDashboard } from './pedidos'
import { listarClientesComMetricas } from './clientes'

/** Imita o PostgREST: nunca devolve mais de 1000 linhas por resposta. */
function bancoFalso(tabelas: Record<string, Record<string, unknown>[]>): SupabaseClient {
  const from = (tabela: string) => {
    const linhas = tabelas[tabela] ?? []
    const b = {
      select: () => b,
      eq: () => b,
      neq: () => b,
      order: () => b,
      range: (de: number, ate: number) => Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: linhas.slice(0, 1000), error: null }).then(ok),
    }
    return b
  }
  return { from } as unknown as SupabaseClient
}

const antigo = '2025-01-10T15:00:00.000Z'
const hoje = new Date().toISOString()
const pedido = (i: number, criado_em: string) => ({
  total: 10, tipo: 'entrega', status: 'entregue', forma_pagamento: 'pix', criado_em,
  cliente_nome: `C${i}`, cliente_telefone: `27999${String(i).padStart(6, '0')}`,
  endereco_rua: '', endereco_numero: '', endereco_bairro: '', endereco_cep: '', pedido_itens: [],
})

describe('loja com mais de 1000 pedidos', () => {
  const pedidos = [...Array.from({ length: 1500 }, (_, i) => pedido(i, antigo)), pedido(9999, hoje)]

  it('Dashboard enxerga o pedido de hoje (o 1501º)', async () => {
    const { pedidos: lidos } = await carregarDashboard(bancoFalso({ pedidos, itens_cardapio: [] }), 'loja')
    expect(lidos).toHaveLength(1501)
    expect(lidos.some((p) => p.criadoEm === hoje)).toBe(true)
  })

  it('Clientes lista o cliente novo', async () => {
    const lista = await listarClientesComMetricas(bancoFalso({ pedidos, clientes: [] }), 'loja')
    expect(lista).toHaveLength(1501)
  })
})
