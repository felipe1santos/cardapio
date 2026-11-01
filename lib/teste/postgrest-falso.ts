import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase falso para testes de paginação (01/11/2026, Fase 4): corta como o PostgREST de produção — `.limit(n)` devolve
 * no máximo 1.000 linhas (max_rows, supabase/config.toml), `.range(de, ate)` devolve a fatia pedida. Filtros são
 * ignorados: cada teste passa só as linhas que a consulta devolveria. `unicos[tabela]` responde `.maybeSingle()`.
 */
export const MAX_ROWS = 1000
export function postgrestFalso(tabelas: Record<string, Record<string, unknown>[]>, unicos: Record<string, Record<string, unknown> | null> = {}): SupabaseClient {
  const from = (t: string) => {
    const linhas = tabelas[t] ?? []
    let de = 0, ate = Math.min(MAX_ROWS, linhas.length) - 1
    const c: Record<string, unknown> = {}
    const self = () => c
    for (const m of ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'not', 'order', 'is']) c[m] = self
    c.limit = (n: number) => { ate = Math.min(de + n, de + MAX_ROWS, linhas.length) - 1; return c }
    c.range = (d: number, a: number) => { de = d; ate = Math.min(a, d + MAX_ROWS - 1, linhas.length - 1); return c }
    c.maybeSingle = async () => ({ data: unicos[t] ?? null, error: null })
    c.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve({ data: linhas.slice(de, ate + 1), error: null }).then(ok, erro)
    return c
  }
  return { from } as unknown as SupabaseClient
}
