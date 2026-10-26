import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { carregarDadosAtivacao } from './controle-caixa'

/**
 * Revisão de arquitetura (26/10): o PostgREST devolve no máximo 1.000 linhas (supabase/config.toml max_rows). Com
 * `.limit(5000)`, o saldo do motoboy somava só as primeiras mil linhas — passado isso, saldo errado. Agora pagina.
 */

const MAX_ROWS = 1000

function supabaseComTeto(lancamentos: Record<string, unknown>[]) {
  const from = (tabela: string) => {
    let de = 0
    let ate = Number.POSITIVE_INFINITY
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'lt', 'order', 'gt', 'not', 'gte', 'limit']) q[m] = () => q
    q.range = (a: number, b: number) => { de = a; ate = b; return q }
    q.maybeSingle = async () => ({ data: null, error: null })
    q.then = (ok: (v: unknown) => unknown) => {
      const todas = tabela === 'fin_lancamentos' ? lancamentos : []
      const fatia = todas.slice(de, Math.min(ate + 1, de + MAX_ROWS))
      return Promise.resolve({ data: fatia, error: null, count: 0 }).then(ok)
    }
    return q
  }
  return { from, rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient
}

describe('carregarDadosAtivacao — saldo do motoboy acima de 1.000 lançamentos', () => {
  it('soma TODOS os lançamentos, não só os primeiros mil', async () => {
    // 1.500 lançamentos de R$ 1 a receber do motoboy "m1" → saldo R$ 1.500.
    const linhas = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, entregador_id: 'm1', valor_centavos: 100, entregadores: { nome: 'Zé' } }))
    const d = await carregarDadosAtivacao(supabaseComTeto(linhas), 'loja')
    expect(d.motoboysPendentes).toEqual([{ nome: 'Zé', centavos: 150_000 }])
  })
})
