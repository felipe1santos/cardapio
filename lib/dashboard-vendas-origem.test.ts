import { describe, expect, it } from 'vitest'
import { vendasPorOrigem } from './dashboard-vendas-origem'

const p = (total: number, origemVenda: 'vitrine' | 'pdv' | 'mesa', origemCanal: string | null, origemPrimeira: string | null = null) => ({ total, origemVenda, origemCanal, origemPrimeira })

describe('Vendas por origem (Dashboard, 10/10)', () => {
  const pedidos = [
    p(50, 'vitrine', 'instagram', 'google_busca'),
    p(30, 'vitrine', 'google_busca', 'google_busca'),
    p(20, 'vitrine', 'direto', 'direto'),
    p(10, 'vitrine', null),
    p(40, 'pdv', null),
    p(25.5, 'mesa', null),
  ]
  it('última origem ("de onde pediu"): canais da vitrine + PDV + Mesa + Sem origem; totais = soma de tudo (bate com o Resumo)', () => {
    const r = vendasPorOrigem(pedidos, 'ultima')
    const de = (k: string) => r.linhas.find((l) => l.chave === k)
    expect(de('instagram')).toMatchObject({ pedidos: 1, faturamento: 50 })
    expect(de('pdv')).toMatchObject({ pedidos: 1, faturamento: 40 })
    expect(de('mesa')).toMatchObject({ pedidos: 1, faturamento: 25.5 })
    expect(de('sem_origem')).toMatchObject({ pedidos: 1, faturamento: 10 })
    expect(r.totais).toEqual({ pedidos: 6, faturamento: 175.5 })
    expect(r.linhas.reduce((s, l) => s + l.faturamento, 0)).toBe(175.5)
  })
  it('primeira origem ("como conheceu"): pedido sem a primeira gravada fica em Sem origem', () => {
    const r = vendasPorOrigem(pedidos, 'primeira')
    expect(r.linhas.find((l) => l.chave === 'google_busca')).toMatchObject({ pedidos: 2, faturamento: 80 })
    expect(r.linhas.find((l) => l.chave === 'sem_origem')).toMatchObject({ pedidos: 1, faturamento: 10 })
    expect(r.totais).toEqual({ pedidos: 6, faturamento: 175.5 })
  })
  it('ordena do maior faturamento para o menor; período vazio = sem linhas', () => {
    const r = vendasPorOrigem(pedidos, 'ultima')
    const f = r.linhas.map((l) => l.faturamento)
    expect([...f].sort((a, b) => b - a)).toEqual(f)
    expect(vendasPorOrigem([], 'ultima')).toEqual({ linhas: [], totais: { pedidos: 0, faturamento: 0 } })
  })
})
