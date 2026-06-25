// Lógica pura do acesso da cozinha por estação: o que cada modo VÊ e o que pode FAZER.
// Sem dependência de Supabase — é o gate testável reusado pela rota de ação (servidor).
import type { StatusPedido } from '@/lib/queries/pedidos'

export type ModoEstacao = 'producao' | 'expedicao' | 'completa'
export type AcaoCozinha = 'aceitar' | 'pronto' | 'entregue'

export const MODOS: ModoEstacao[] = ['producao', 'expedicao', 'completa']

export const LABEL_MODO: Record<ModoEstacao, string> = {
  producao: 'Produção',
  expedicao: 'Expedição',
  completa: 'Cozinha completa',
}

const STATUS_POR_MODO: Record<ModoEstacao, StatusPedido[]> = {
  producao: ['recebido', 'preparando'],
  expedicao: ['pronto'],
  completa: ['recebido', 'preparando', 'pronto'],
}

const ACOES_POR_MODO: Record<ModoEstacao, AcaoCozinha[]> = {
  producao: ['aceitar', 'pronto'],
  expedicao: ['entregue'],
  completa: ['aceitar', 'pronto', 'entregue'],
}

/** Status de pedido que a estação enxerga, conforme o modo. */
export function statusVisiveis(modo: ModoEstacao): StatusPedido[] {
  return STATUS_POR_MODO[modo]
}

/** Se o modo permite a ação. Gate de segurança — chamado no servidor antes de mutar. */
export function podeExecutar(modo: ModoEstacao, acao: AcaoCozinha): boolean {
  return ACOES_POR_MODO[modo].includes(acao)
}

/**
 * Transição de status de uma ação. `viaEntregue` indica usar marcarPedidoEntregue
 * (que registra a entrega) em vez de só avançar o status.
 */
export function transicaoDe(acao: AcaoCozinha): { status: StatusPedido; viaEntregue: boolean } {
  if (acao === 'aceitar') return { status: 'preparando', viaEntregue: false }
  if (acao === 'pronto') return { status: 'pronto', viaEntregue: false }
  return { status: 'entregue', viaEntregue: true }
}
