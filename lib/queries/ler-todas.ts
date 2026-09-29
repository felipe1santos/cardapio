/** Teto de linhas por resposta do PostgREST (max_rows do Supabase). */
const PAGINA = 1000

/**
 * Lê TODAS as linhas, de 1000 em 1000. Sem isso o PostgREST corta em 1000 calado — e a
 * consulta parece certa em loja pequena. A consulta precisa de ordem estável (termine
 * em `id`) para as páginas não se sobreporem.
 */
export async function lerTodas<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1)
    if (error) throw error
    const lote = data ?? []
    todas.push(...lote)
    if (lote.length < PAGINA) return todas
  }
}
