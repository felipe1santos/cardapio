// Motivos de cancelamento de pedido — lista fechada, compartilhada entre a UI do
// Kanban e a validação da rota de cancelamento.

export type MotivoCancelamento =
  | 'teste'
  | 'cliente_desistiu'
  | 'sem_estoque'
  | 'trote'
  | 'outro'
  | 'nao_entregue'
  | 'pix_expirado'
  | 'pagamento_expirado'

const ROTULOS: Record<MotivoCancelamento, string> = {
  teste: 'Pedido teste',
  cliente_desistiu: 'Cliente desistiu',
  sem_estoque: 'Sem estoque',
  trote: 'Trote / cliente inexistente',
  outro: 'Outro motivo',
  nao_entregue: 'Não entregue pelo entregador',
  pix_expirado: 'Pix não pago no prazo',
  pagamento_expirado: 'Pagamento online não feito no prazo',
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

// ── Cancelado ≠ Não entregue (Bloco B, 19/10/2026) ────────────────────────────
// `cancelado_por` guarda quem cancelou com um prefixo fixo desde 19/10: "Loja: Nome" (painel), "Cliente (WhatsApp
// robô|IA)" (solicitação do cliente; "· aplicado por Nome" quando a loja aplicou), "Entregador: Nome" (app do motoboy),
// "sistema" (Pix/cartão expirado). Os formatos anteriores (e-mail, "Robô (WhatsApp)", "Agente de IA") continuam lidos.
export type OrigemCancelamento = 'cliente' | 'loja' | 'motoboy' | 'sistema'

export interface PedidoCancelavelInfo {
  status: string
  canceladoMotivo: string | null
  canceladoPor: string | null
  canceladoObservacao?: string | null
  etapas?: { emRota: string | null } | null
  saiuParaEntregaEm?: string | null
}

/** "Não entregue" SÓ quando o pedido saiu para entrega e não foi entregue. O resto é "Cancelado". */
export function ehNaoEntregue(p: PedidoCancelavelInfo): boolean {
  return p.status === 'cancelado' && p.canceladoMotivo === 'nao_entregue' && !!(p.etapas?.emRota || p.saiuParaEntregaEm)
}

/** Quem cancelou (origem), o nome quando houver e, no cliente, por onde pediu (robô/IA). */
export function quemCancelou(p: PedidoCancelavelInfo): { origem: OrigemCancelamento; nome: string | null; via: 'robô' | 'IA' | null } {
  const por = (p.canceladoPor ?? '').trim()
  if (/^entregador\b/i.test(por)) return { origem: 'motoboy', nome: por.replace(/^entregador\s*:?\s*/i, '').trim() || null, via: null }
  if (/^cliente\b/i.test(por) || /whatsapp/i.test(por) || /^agente de ia$/i.test(por)) {
    const via = /\bia\b|agente/i.test(por) ? 'IA' : /rob/i.test(por) ? 'robô' : null
    const aplicado = por.match(/aplicado por\s+(.+)$/i)
    return { origem: 'cliente', nome: aplicado ? aplicado[1].trim() : null, via }
  }
  if (/^sistema$/i.test(por) || p.canceladoMotivo === 'pix_expirado' || p.canceladoMotivo === 'pagamento_expirado') return { origem: 'sistema', nome: null, via: null }
  return { origem: 'loja', nome: por.replace(/^loja\s*:?\s*/i, '').trim() || null, via: null }
}

/** Título ("Cancelado" | "Não entregue"), quem ("pela loja · Ana") e motivo legível — o mesmo no card, painel e relatórios. */
export function rotuloCancelamento(p: PedidoCancelavelInfo): { titulo: 'Cancelado' | 'Não entregue'; quem: string; motivo: string } {
  const q = quemCancelou(p)
  const naoEntregue = ehNaoEntregue(p)
  const quem = q.origem === 'cliente' ? `pelo cliente${q.via ? ` (${q.via})` : ''}${q.nome ? ` · aplicado por ${q.nome}` : ''}`
    : q.origem === 'motoboy' ? `pelo motoboy${q.nome ? ` ${q.nome}` : ''}`
    : q.origem === 'sistema' ? 'pelo sistema'
    : `pela loja${q.nome ? ` · ${q.nome}` : ''}`
  const obs = (p.canceladoObservacao ?? '').trim()
  // "Não entregue": o motivo é o que foi escrito (ex.: "cliente não atendeu"); sem texto, o rótulo do motivo.
  const motivo = naoEntregue ? obs || rotuloMotivo(p.canceladoMotivo) : [rotuloMotivo(p.canceladoMotivo), obs].filter(Boolean).join(' · ')
  return { titulo: naoEntregue ? 'Não entregue' : 'Cancelado', quem, motivo }
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
  motivoApp?: string,
): Promise<void> {
  const res = await fetch(`/api/admin/pedidos/${pedidoId}/cancelar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo, observacao, motivoApp }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? 'Não foi possível cancelar o pedido.')
  }
}
