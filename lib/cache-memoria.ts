/**
 * Cache em memória com prazo (01/11/2026, Fase 3): para dado que muda raramente e era relido em todo poll (logo da
 * loja, módulo financeiro no app do motoboy). O app roda num container só; quem muda o dado chama `esquecer`.
 */
export interface Guardado<T> { valor: T; ate: number }

export async function lembrar<T>(mapa: Map<string, Guardado<T>>, chave: string, ttlMs: number, agora: number, calcular: () => Promise<T>): Promise<T> {
  const g = mapa.get(chave)
  if (g && agora < g.ate) return g.valor
  const valor = await calcular()
  mapa.set(chave, { valor, ate: agora + ttlMs })
  return valor
}

export function esquecer<T>(mapa: Map<string, Guardado<T>>, chave: string): void {
  mapa.delete(chave)
}
