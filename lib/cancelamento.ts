// Motivos de cancelamento de pedido — lista fechada, compartilhada entre a UI do
// Kanban e a validação da rota de cancelamento.

export type MotivoCancelamento =
  | 'teste'
  | 'cliente_desistiu'
  | 'sem_estoque'
  | 'trote'
  | 'outro'
  | 'nao_entregue'

const ROTULOS: Record<MotivoCancelamento, string> = {
  teste: 'Pedido teste',
  cliente_desistiu: 'Cliente desistiu',
  sem_estoque: 'Sem estoque',
  trote: 'Trote / cliente inexistente',
  outro: 'Outro motivo',
  nao_entregue: 'Não entregue pelo entregador',
}

/** Motivos oferecidos no modal do Kanban. `nao_entregue` fica de fora: é gravado
 *  automaticamente pelo botão "Não entregue" da Logística, não é escolha do operador. */
export const MOTIVOS_CANCELAMENTO: { slug: MotivoCancelamento; label: string }[] = (
  ['teste', 'cliente_desistiu', 'sem_estoque', 'trote', 'outro'] as const
).map((slug) => ({ slug, label: ROTULOS[slug] }))

export function motivoValido(valor: unknown): valor is MotivoCancelamento {
  return typeof valor === 'string' && valor in ROTULOS
}

/** Rótulo legível de um motivo gravado; devolve o próprio valor se for desconhecido. */
export function rotuloMotivo(slug: string | null): string {
  if (!slug) return '—'
  return ROTULOS[slug as MotivoCancelamento] ?? slug
}

/** Status em que o pedido não pode mais ser cancelado. */
export const STATUS_NAO_CANCELAVEIS = ['entregue', 'cancelado'] as const

export function podeCancelar(status: string): boolean {
  return !STATUS_NAO_CANCELAVEIS.includes(status as (typeof STATUS_NAO_CANCELAVEIS)[number])
}

/**
 * Cancela um pedido pelo painel. Só do navegador — a rota valida o motivo, guarda o
 * status server-side e reverte cupom/recompensa de fidelidade.
 */
export async function cancelarPedidoRequest(
  pedidoId: string,
  motivo: MotivoCancelamento,
  observacao: string,
): Promise<void> {
  const res = await fetch(`/api/admin/pedidos/${pedidoId}/cancelar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo, observacao }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? 'Não foi possível cancelar o pedido.')
  }
}
