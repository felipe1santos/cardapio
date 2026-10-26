import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { desdeNecessario, precisaRecarregar } from './dashboard-janela'
import { intervaloDoPreset } from './dashboard-metricas'
import { carregarDashboard } from './queries/pedidos'

/**
 * Achado #8 da auditoria (25/10): o Dashboard baixava o histórico INTEIRO de pedidos com itens a cada abertura e
 * filtrava o período no navegador. Agora: pedidos completos só da janela do período (+ o anterior, para a variação) e
 * um histórico leve (cliente + data) para "novos x recorrentes". "Tudo" continua carregando tudo.
 */

const AGORA = new Date('2026-10-26T15:00:00').getTime()
const DIA = 86_400_000

describe('janela do Dashboard', () => {
  it('30 dias pede desde o início do período anterior (60 dias atrás)', () => {
    const i = intervaloDoPreset('30d', AGORA)
    expect(desdeNecessario(i)).toBe(i.inicio - 30 * DIA)
  })

  it('"Tudo" pede o histórico inteiro (null)', () => {
    expect(desdeNecessario(intervaloDoPreset('tudo', AGORA))).toBeNull()
  })

  it('recarrega só quando o período pede dados mais antigos do que os carregados', () => {
    expect(precisaRecarregar(1000, 2000)).toBe(false) // carregado desde 1000, precisa desde 2000: já tem
    expect(precisaRecarregar(2000, 1000)).toBe(true)
    expect(precisaRecarregar(2000, null)).toBe(true) // pediu "Tudo"
    expect(precisaRecarregar(null, 1000)).toBe(false) // já tem tudo
    expect(precisaRecarregar(undefined, 1000)).toBe(true) // nada carregado ainda
  })
})

describe('carregarDashboard com janela', () => {
  function supabaseFalso() {
    const consultas: { select: string; filtros: string[] }[] = []
    const from = vi.fn((tabela: string) => {
      const reg = { select: '', filtros: [] as string[] }
      if (tabela === 'pedidos') consultas.push(reg)
      const q: Record<string, unknown> = {}
      q.select = (s: string) => { reg.select = s; return q }
      for (const m of ['eq', 'not', 'order', 'range', 'gte']) q[m] = (...a: unknown[]) => { reg.filtros.push(`${m}:${String(a[0])}`); return q }
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok)
      return q
    })
    return { supabase: { from } as unknown as SupabaseClient, consultas }
  }

  it('com janela: pedidos completos filtrados por data e histórico de clientes sem itens', async () => {
    const { supabase, consultas } = supabaseFalso()
    const r = await carregarDashboard(supabase, 'loja', '2026-08-27T03:00:00.000Z')
    const completa = consultas.find((c) => c.select.includes('pedido_itens'))!
    const leve = consultas.find((c) => !c.select.includes('pedido_itens'))!
    expect(completa.filtros).toContain('gte:criado_em')
    expect(leve).toBeTruthy()
    expect(leve.filtros).not.toContain('gte:criado_em')
    expect(r.clientes).toEqual([])
  })

  it('sem janela ("Tudo"): pedidos completos sem filtro de data', async () => {
    const { supabase, consultas } = supabaseFalso()
    await carregarDashboard(supabase, 'loja', null)
    const completa = consultas.find((c) => c.select.includes('pedido_itens'))!
    expect(completa.filtros).not.toContain('gte:criado_em')
  })
})
