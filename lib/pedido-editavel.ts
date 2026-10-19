/**
 * Regra ÚNICA de "este pedido ainda pode ser alterado?" (edição pelo painel, solicitações do cliente pelo robô e
 * pela IA, botão do lápis). Pura e client-safe. Decisões Q2/Q12/Q17 de docs/superpowers/specs/2026-10-18-edicao-pedido-decisoes.md.
 *
 * Despachado = saiu de alguma forma: status em_rota/entregue/cancelado, motoboy atribuído, "Saiu p/ entrega" ou uma
 * corrida da Lalamove chamada (ativa). Retirada: até ser marcada Entregue.
 */
export type MotivoNaoEditavel = 'despachado' | 'entregue' | 'cancelado' | 'aguardando_pagamento' | 'mesa' | 'app_externo'

export interface PedidoParaEditar {
  status: string
  canal?: string | null
  entregadorId?: string | null
  saiuParaEntregaEm?: string | null
  /** Canal de origem (0149). Reservado: origem de app externo (iFood…) bloqueia; hoje não existe nenhuma. */
  origemCanal?: string | null
}

export type Editavel = { ok: true } | { ok: false; motivo: MotivoNaoEditavel; texto: string }

export const TEXTO_NAO_EDITAVEL: Record<MotivoNaoEditavel, string> = {
  despachado: 'Este pedido já saiu para entrega e não pode mais ser alterado.',
  entregue: 'Este pedido já foi entregue e não pode mais ser alterado.',
  cancelado: 'Este pedido foi cancelado.',
  aguardando_pagamento: 'Este pedido está esperando o pagamento online: só dá para cancelar ou trocar a forma de pagamento.',
  mesa: 'Pedido de mesa se altera na conta da mesa (PDV).',
  app_externo: 'Este pedido veio de outro aplicativo: edite no app de origem.',
}

const ORIGENS_EXTERNAS: readonly string[] = ['ifood', '99food', 'rappi']

/** Pode editar itens/endereço/pagamento? `corridaAtiva` = há corrida da Lalamove chamada para o pedido. */
export function pedidoEditavel(p: PedidoParaEditar, corridaAtiva = false): Editavel {
  const nao = (motivo: MotivoNaoEditavel): Editavel => ({ ok: false, motivo, texto: TEXTO_NAO_EDITAVEL[motivo] })
  if (p.canal === 'mesa') return nao('mesa')
  if (p.origemCanal && ORIGENS_EXTERNAS.includes(p.origemCanal)) return nao('app_externo')
  if (p.status === 'cancelado') return nao('cancelado')
  if (p.status === 'entregue') return nao('entregue')
  if (p.status === 'aguardando_pagamento') return nao('aguardando_pagamento')
  if (p.status === 'em_rota' || p.entregadorId || p.saiuParaEntregaEm || corridaAtiva) return nao('despachado')
  if (p.status === 'recebido' || p.status === 'preparando' || p.status === 'pronto') return { ok: true }
  return nao('despachado')
}

/** O cliente pode PEDIR cancelamento/alteração? Mesma regra; "aguardando pagamento" entra (só cancelar/pagamento). */
export function clientePodeSolicitar(p: PedidoParaEditar, corridaAtiva = false): Editavel {
  if (p.status === 'aguardando_pagamento') return { ok: true }
  return pedidoEditavel(p, corridaAtiva)
}
