/**
 * Cache curto, por loja, para os dados de ENFEITE da resposta do Assistente (egress, 26/10): impressoras e dados da loja
 * no rodapé da comanda. A rota é chamada a cada ~20 s por computador; esses dados quase nunca mudam.
 * Nunca para o que decide QUEM imprime (destino da Cozinha, reserva, impressão automática): esses são lidos na hora.
 */
const VALIDADE_MS = 60_000
const guardados = new Map<string, { em: number; valor: unknown }>()

export async function comCacheDaLoja<T>(dado: string, restauranteId: string, ler: () => Promise<T>): Promise<T> {
  const chave = `${dado}:${restauranteId}`
  const g = guardados.get(chave)
  if (g && Date.now() - g.em < VALIDADE_MS) return g.valor as T
  const valor = await ler()
  guardados.set(chave, { em: Date.now(), valor })
  return valor
}

/** Só para testes. */
export function _limparCacheAgente() {
  guardados.clear()
}
