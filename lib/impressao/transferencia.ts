/**
 * Transferência da ficha da cozinha para o Assistente Beta (0100).
 *
 * O Assistente antigo lista a fila sem reservar. Logo depois da troca, um pedido anterior
 * pode estar sendo impresso por ele. O Beta só pega esses pedidos depois da janela — se o
 * antigo não os imprimiu nesse tempo, não vai imprimir mais (ele já recebe lista vazia).
 * Pedidos criados depois da troca vão direto para o Beta.
 */
export const JANELA_TRANSFERENCIA_MS = 45_000

export function aposCorteDaTransferencia<T extends { criadoEm?: string | null }>(
  pedidos: T[],
  transferidaEm: string | null,
  agora = Date.now(),
): T[] {
  if (!transferidaEm) return pedidos
  const corte = new Date(transferidaEm).getTime()
  if (!Number.isFinite(corte) || agora - corte >= JANELA_TRANSFERENCIA_MS) return pedidos
  return pedidos.filter((p) => !!p.criadoEm && new Date(p.criadoEm).getTime() >= corte)
}
