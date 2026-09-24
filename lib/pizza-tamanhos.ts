/**
 * Quais tamanhos da loja uma pizza VENDE.
 *
 * Os tamanhos moram no catálogo da loja (`tamanhos_padrao_pizza`) e o preço mora
 * em cada sabor (`pizza_sabor_precos`). Não existe tabela "pizza × tamanho": até
 * a 0097 a regra era só "tamanho com preço em algum sabor". A 0097 somou a lista
 * `pizza_tamanhos_ocultos` — os tamanhos que o dono DESLIGOU nesta pizza, sem
 * apagar nem zerar preço nenhum.
 *
 * Vitrine, PDV, QR da mesa e painel do garçom usam esta função, e o servidor usa
 * `tamanhoOcultoNaPizza` para recusar o que a tela não mostraria. Antes eram
 * quatro cópias da mesma regra.
 */

export interface PrecoPorTamanho {
  tamanhoPadraoId: string
  preco: number
}

/** Sabor no formato do admin/PDV (lista) ou da mesa (mapa tamanhoId → preço). */
export type PrecosDoSabor = PrecoPorTamanho[] | Record<string, number>

export function precoDoSaborNoTamanho(precos: PrecosDoSabor, tamanhoId: string): number {
  if (Array.isArray(precos)) return precos.find((p) => p.tamanhoPadraoId === tamanhoId)?.preco ?? 0
  return precos[tamanhoId] ?? 0
}

export function tamanhoOcultoNaPizza(ocultos: readonly string[] | null | undefined, tamanhoId: string): boolean {
  return (ocultos ?? []).includes(tamanhoId)
}

/**
 * Tamanhos que o cliente/operador pode escolher, na ordem do catálogo.
 *
 * - Tamanho desligado nesta pizza nunca aparece.
 * - Dos demais, aparecem os que têm preço (> 0) em pelo menos um sabor.
 * - Se nenhum tem preço, aparecem todos os ligados — é o comportamento de antes
 *   da 0097, preservado para loja que ainda não precificou.
 */
export function tamanhosVendidosDaPizza<T extends { id: string }>(
  tamanhos: readonly T[],
  sabores: readonly { precos: PrecosDoSabor }[],
  ocultos?: readonly string[] | null,
): T[] {
  const ligados = tamanhos.filter((t) => !tamanhoOcultoNaPizza(ocultos, t.id))
  const comPreco = ligados.filter((t) => sabores.some((s) => precoDoSaborNoTamanho(s.precos, t.id) > 0))
  return comPreco.length > 0 ? comPreco : ligados
}

/** Situação de um tamanho numa pizza, para o cadastro mostrar sem o dono precisar adivinhar. */
export type SituacaoTamanhoPizza = 'desligado' | 'sem_preco' | 'parcial' | 'completo'

export function situacaoTamanhoPizza(
  tamanhoId: string,
  sabores: readonly { precos: PrecosDoSabor }[],
  ocultos?: readonly string[] | null,
): SituacaoTamanhoPizza {
  if (tamanhoOcultoNaPizza(ocultos, tamanhoId)) return 'desligado'
  const comPreco = sabores.filter((s) => precoDoSaborNoTamanho(s.precos, tamanhoId) > 0).length
  if (comPreco === 0) return 'sem_preco'
  return comPreco === sabores.length ? 'completo' : 'parcial'
}
