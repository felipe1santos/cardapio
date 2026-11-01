import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase falso que GRAVA o que foi consultado (01/11/2026, Fase 5): para provar que uma rotina não toca numa tabela
 * (recurso desligado = zero consulta) ou que consulta uma vez só (sem N+1). Filtros são ignorados; `respostas[tabela]`
 * é o que a consulta devolve (lista para a consulta, 1º item para maybeSingle/single); `rpc` devolve `rpcs[fn]`.
 */
export interface Consulta { tabela: string; op: string; filtros: Record<string, unknown>[] }

export function adminGravador(respostas: Record<string, Record<string, unknown>[]> = {}, rpcs: Record<string, unknown> = {}) {
  const consultas: Consulta[] = []
  const from = (tabela: string) => {
    const atual: Consulta = { tabela, op: 'select', filtros: [] }
    consultas.push(atual)
    const linhas = respostas[tabela] ?? []
    const c: Record<string, unknown> = {}
    const self = () => c
    for (const m of ['select', 'order', 'limit', 'range']) c[m] = self
    for (const m of ['eq', 'neq', 'gte', 'lte', 'lt', 'gt', 'in', 'not', 'is', 'or']) c[m] = (...a: unknown[]) => { atual.filtros.push({ [m]: a }); return c }
    for (const m of ['update', 'insert', 'upsert', 'delete']) c[m] = (v?: unknown) => { atual.op = m; atual.filtros.push({ valor: v }); return c }
    c.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null })
    c.single = async () => ({ data: linhas[0] ?? null, error: null })
    c.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: atual.op === 'select' ? linhas : [], error: null }).then(ok, erro)
    return c
  }
  const rpc = async (fn: string) => ({ data: rpcs[fn] ?? null, error: null })
  const admin = { from, rpc } as unknown as SupabaseClient
  const vezes = (tabela: string, op = 'select') => consultas.filter((q) => q.tabela === tabela && q.op === op).length
  return { admin, consultas, vezes }
}
