import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { lerTodas, resolverDestinatarios } from './campanhas'

/** Imita o PostgREST: nunca devolve mais de 1000 linhas por resposta. */
function bancoFalso(tabelas: Record<string, Record<string, unknown>[]>) {
  const consultas: string[] = []
  const from = (tabela: string) => {
    const b = {
      select: () => b,
      eq: () => b,
      neq: () => b,
      order: () => b,
      range: (de: number, ate: number) => {
        consultas.push(`${tabela}:${de}-${ate}`)
        const linhas = tabelas[tabela] ?? []
        const fim = Math.min(ate + 1, de + 1000)
        return Promise.resolve({ data: linhas.slice(de, fim), error: null })
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: (tabelas[tabela] ?? []).slice(0, 1000), error: null }).then(ok),
    }
    return b
  }
  return { cliente: { from } as unknown as SupabaseClient, consultas }
}

const tel = (i: number) => `27999${String(i).padStart(6, '0')}`
const DIA = 86_400_000

describe('público da campanha em loja grande (mais de 1000 linhas)', () => {
  it('"todos" alcança todos os clientes, não só os 1000 primeiros', async () => {
    const clientes = Array.from({ length: 2500 }, (_, i) => ({ telefone: tel(i), nome: `C${i}` }))
    const { cliente } = bancoFalso({ clientes })
    const lista = await resolverDestinatarios(cliente, 'loja', { tipo: 'todos' })
    expect(lista).toHaveLength(2500)
  })

  it('"inativos" enxerga o pedido recente mesmo depois do milésimo pedido', async () => {
    const clientes = [{ telefone: tel(1), nome: 'Ativo' }, { telefone: tel(2), nome: 'Sumido' }]
    const antigo = new Date(Date.now() - 60 * DIA).toISOString()
    const pedidos = [
      // 1200 pedidos antigos de outros clientes; o do "Ativo" de ontem vem depois deles.
      ...Array.from({ length: 1200 }, (_, i) => ({ cliente_telefone: tel(1000 + i), criado_em: antigo, total: 10 })),
      { cliente_telefone: tel(2), criado_em: antigo, total: 10 },
      { cliente_telefone: tel(1), criado_em: new Date(Date.now() - DIA).toISOString(), total: 10 },
    ]
    const { cliente } = bancoFalso({ clientes, pedidos })
    const lista = await resolverDestinatarios(cliente, 'loja', { tipo: 'inativos', dias_inativo: 7 })
    expect(lista.map((c) => c.nome)).toEqual(['Sumido'])
  })

  it('lerTodas para na página incompleta e propaga erro', async () => {
    const { cliente, consultas } = bancoFalso({ t: Array.from({ length: 2000 }, (_, i) => ({ i })) })
    const linhas = await lerTodas((de, ate) => cliente.from('t').select('*').range(de, ate) as unknown as PromiseLike<{ data: { i: number }[]; error: null }>)
    expect(linhas).toHaveLength(2000)
    expect(consultas).toEqual(['t:0-999', 't:1000-1999', 't:2000-2999'])
    await expect(lerTodas(() => Promise.resolve({ data: null, error: new Error('falhou') }))).rejects.toThrow('falhou')
  })
})

describe('filtro "dia da semana"', () => {
  it('usa o dia de São Paulo, não o do servidor (UTC)', async () => {
    const clientes = [{ telefone: tel(1), nome: 'Domingo à noite' }]
    // Domingo 2026-09-27 21:30 em São Paulo = segunda 00:30 UTC.
    const pedidos = [{ cliente_telefone: tel(1), criado_em: '2026-09-28T00:30:00.000Z', total: 30 }]
    const tzAntes = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      const { cliente } = bancoFalso({ clientes, pedidos })
      expect(await resolverDestinatarios(cliente, 'loja', { tipo: 'dias_semana', dias_semana: [0] })).toHaveLength(1)
      expect(await resolverDestinatarios(cliente, 'loja', { tipo: 'dias_semana', dias_semana: [1] })).toHaveLength(0)
    } finally {
      if (tzAntes === undefined) delete process.env.TZ
      else process.env.TZ = tzAntes
    }
  })
})
