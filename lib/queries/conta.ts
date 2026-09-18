import type { SupabaseClient } from '@supabase/supabase-js'
import { mensagemDeErroConta, type FormaPagamento } from '@/lib/conta'
import { ROTULO_EVENTO } from '@/lib/queries/auditoria'

/**
 * Leitura e operações da conta de uma mesa. Tudo com `service_role`, chamado por rota
 * que já conferiu sessão e permissão.
 *
 * As operações que mexem em dinheiro ou em várias linhas são funções do banco (0067):
 * aqui só se chama cada uma e se traduz o erro. Nenhuma regra de valor é refeita em
 * TypeScript.
 */

export interface TotaisConta {
  subtotal: number
  taxaServico: number
  desconto: number
  total: number
  pago: number
  restante: number
}

export interface ItemDaConta {
  id: string
  nome: string
  quantidade: number
  precoUnitario: number
  complementos: string[]
  observacao: string | null
  cancelado: boolean
  canceladoMotivo: string | null
  canceladoPor: string | null
}

export interface LancamentoDaConta {
  id: string
  numero: number
  status: string
  total: number
  criadoEm: string
  criadoPorNome: string | null
  impresso: boolean
  itens: ItemDaConta[]
}

export interface PagamentoDaConta {
  id: string
  forma: FormaPagamento
  valor: number
  valorRecebido: number | null
  troco: number
  criadoPorNome: string
  criadoEm: string
  estornado: boolean
  estornoMotivo: string | null
  estornadoPorNome: string | null
  observacao: string | null
}

/** Pedido do garçom para cancelar algo que já foi para a cozinha (0072). */
export interface SolicitacaoCancelamento {
  id: string
  pedidoId: string
  /** Null = o lançamento inteiro. */
  itemId: string | null
  /** O que o garçom quer cancelar, para a gestão decidir sem caçar a linha. */
  descricao: string
  motivo: string
  solicitadoPorNome: string
  solicitadoEm: string
}

export interface ContaDaMesa {
  comandaId: string
  /** Número sequencial da comanda na loja. Null em comanda anterior à 0072. */
  numero: number | null
  abertaEm: string
  pessoas: number | null
  observacoes: string | null
  responsavelNome: string | null
  taxaServicoPercentual: number
  descontoTipo: 'valor' | 'percentual'
  descontoValor: number
  descontoPercentual: number
  descontoMotivo: string | null
  totais: TotaisConta
  lancamentos: LancamentoDaConta[]
  pagamentos: PagamentoDaConta[]
  /** Pedidos de cancelamento ainda sem decisão. A conta não fecha com eles. */
  solicitacoes: SolicitacaoCancelamento[]
}

export type ResultadoOp<T = unknown> = { ok: true; valor: T } | { ok: false; erro: string; codigo: string }

function codigoDo(message: string | undefined): string {
  return (message ?? '').replace(/^[\s\S]*?(\w+)(:[\d.]+)?$/, '$1')
}

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ResultadoOp<T>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) {
    // A tela recebe uma frase tratada; o log fica com a mensagem crua. Sem isto, falha
    // inesperada da função virava "Não foi possível concluir a operação." sem rastro.
    console.error(`[conta] ${fn} falhou:`, error.message)
    return { ok: false, erro: mensagemDeErroConta(error.message), codigo: codigoDo(error.message) }
  }
  return { ok: true, valor: data as T }
}

export async function buscarComandaAbertaDaMesa(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from('comandas')
    .select('id')
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .eq('status', 'aberta')
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

export async function buscarConta(admin: SupabaseClient, restauranteId: string, mesaId: string): Promise<ContaDaMesa | null> {
  const { data: c } = await admin
    .from('comandas')
    .select('id, numero, aberta_em, pessoas, observacoes, responsavel_nome, taxa_servico_percentual, desconto_tipo, desconto_valor, desconto_percentual, desconto_motivo')
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .eq('status', 'aberta')
    .maybeSingle()
  if (!c) return null
  const comanda = c as {
    id: string; numero: number | null; aberta_em: string; pessoas: number | null; observacoes: string | null; responsavel_nome: string | null
    taxa_servico_percentual: number; desconto_tipo: string | null; desconto_valor: number; desconto_percentual: number | null
    desconto_motivo: string | null
  }

  const [{ data: t }, { data: peds }, { data: pags }, { data: sols }] = await Promise.all([
    admin.rpc('comanda_totais', { p_comanda: comanda.id }),
    admin
      .from('pedidos')
      .select('id, numero, status, total, criado_em, criado_por_nome, impresso, pedido_itens ( id, nome, quantidade, preco_unitario, complementos, observacao, cancelado_em, cancelado_motivo, cancelado_por_nome )')
      .eq('comanda_id', comanda.id)
      .order('criado_em', { ascending: true }),
    admin
      .from('pagamentos_comanda')
      .select('id, forma, valor, valor_recebido, troco, criado_por_nome, criado_em, estornado_em, estorno_motivo, estornado_por_nome, observacao')
      .eq('comanda_id', comanda.id)
      .order('criado_em', { ascending: true }),
    admin
      .from('solicitacoes_cancelamento')
      .select('id, pedido_id, pedido_item_id, motivo, solicitado_por_nome, solicitado_em, pedidos!inner ( comanda_id )')
      .eq('restaurante_id', restauranteId)
      .eq('status', 'pendente')
      .eq('pedidos.comanda_id', comanda.id)
      .order('solicitado_em', { ascending: true }),
  ])

  const tot = ((t as unknown[] | null) ?? [])[0] as Record<string, string | number> | undefined

  const lancamentos = ((peds ?? []) as unknown as {
      id: string; numero: number; status: string; total: number; criado_em: string; criado_por_nome: string | null; impresso: boolean
      pedido_itens: { id: string; nome: string; quantidade: number; preco_unitario: number; complementos: { nome: string }[] | null; observacao: string | null; cancelado_em: string | null; cancelado_motivo: string | null; cancelado_por_nome: string | null }[]
    }[]).map((p) => ({
      id: p.id,
      numero: p.numero,
      status: p.status,
      total: Number(p.total),
      criadoEm: p.criado_em,
      criadoPorNome: p.criado_por_nome,
      impresso: p.impresso,
      itens: (p.pedido_itens ?? []).map((i) => ({
        id: i.id,
        nome: i.nome,
        quantidade: i.quantidade,
        precoUnitario: Number(i.preco_unitario),
        complementos: (i.complementos ?? []).map((x) => x.nome),
        observacao: i.observacao,
        cancelado: i.cancelado_em !== null,
        canceladoMotivo: i.cancelado_motivo,
        canceladoPor: i.cancelado_por_nome,
      })),
    }))

  const descreverAlvo = (pedidoId: string, itemId: string | null): string => {
    const lanc = lancamentos.find((l) => l.id === pedidoId)
    if (!lanc) return 'Lançamento'
    if (!itemId) return `Lançamento #${lanc.numero} inteiro`
    const item = lanc.itens.find((i) => i.id === itemId)
    return item ? `${item.quantidade}× ${item.nome} (#${lanc.numero})` : `Item do lançamento #${lanc.numero}`
  }

  return {
    comandaId: comanda.id,
    numero: comanda.numero,
    abertaEm: comanda.aberta_em,
    pessoas: comanda.pessoas,
    observacoes: comanda.observacoes,
    responsavelNome: comanda.responsavel_nome,
    taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
    descontoTipo: comanda.desconto_tipo === 'percentual' ? 'percentual' : 'valor',
    descontoValor: Number(comanda.desconto_valor),
    descontoPercentual: Number(comanda.desconto_percentual ?? 0),
    descontoMotivo: comanda.desconto_motivo,
    totais: {
      subtotal: Number(tot?.subtotal ?? 0),
      taxaServico: Number(tot?.taxa_servico ?? 0),
      desconto: Number(tot?.desconto ?? 0),
      total: Number(tot?.total ?? 0),
      pago: Number(tot?.pago ?? 0),
      restante: Number(tot?.restante ?? 0),
    },
    lancamentos,
    pagamentos: ((pags ?? []) as unknown as {
      id: string; forma: FormaPagamento; valor: number; valor_recebido: number | null; troco: number; criado_por_nome: string
      criado_em: string; estornado_em: string | null; estorno_motivo: string | null; estornado_por_nome: string | null
      observacao: string | null
    }[]).map((p) => ({
      id: p.id,
      forma: p.forma,
      valor: Number(p.valor),
      valorRecebido: p.valor_recebido === null ? null : Number(p.valor_recebido),
      troco: Number(p.troco),
      criadoPorNome: p.criado_por_nome,
      criadoEm: p.criado_em,
      estornado: p.estornado_em !== null,
      estornoMotivo: p.estorno_motivo,
      estornadoPorNome: p.estornado_por_nome,
      observacao: p.observacao,
    })),
    solicitacoes: ((sols ?? []) as unknown as {
      id: string; pedido_id: string; pedido_item_id: string | null; motivo: string; solicitado_por_nome: string; solicitado_em: string
    }[]).map((x) => ({
      id: x.id,
      pedidoId: x.pedido_id,
      itemId: x.pedido_item_id,
      descricao: descreverAlvo(x.pedido_id, x.pedido_item_id),
      motivo: x.motivo,
      solicitadoPorNome: x.solicitado_por_nome,
      solicitadoEm: x.solicitado_em,
    })),
  }
}

// ── operações (funções da 0067/0070/0072) ───────────────────────────────────

export const registrarPagamento = (
  admin: SupabaseClient,
  a: {
    restauranteId: string; comandaId: string; forma: FormaPagamento; valor: number; recebido: number | null; chave: string
    atorId: string; atorNome: string
    /** Obrigatória no fiado: de quem é a conta pendurada. */
    observacao?: string | null
  },
) =>
  rpc<{ id: string; idempotente: boolean; troco?: number }>(admin, 'comanda_registrar_pagamento', {
    p_restaurante: a.restauranteId, p_comanda: a.comandaId, p_forma: a.forma, p_valor: a.valor,
    p_recebido: a.recebido, p_chave: a.chave, p_ator: a.atorId, p_ator_nome: a.atorNome,
    p_observacao: a.observacao ?? null,
  })

/** Taxa e desconto numa transação só, com trava e auditoria de antes e depois (0072). */
export const ajustarValores = (
  admin: SupabaseClient,
  a: {
    restauranteId: string; comandaId: string
    /** Undefined/null = não mexe. */
    taxa?: number | null
    descontoTipo?: 'valor' | 'percentual' | null
    descontoValor?: number | null
    descontoPercentual?: number | null
    motivo?: string | null
    atorId: string; atorNome: string
  },
) =>
  rpc<Record<string, number>>(admin, 'comanda_ajustar_valores', {
    p_restaurante: a.restauranteId, p_comanda: a.comandaId, p_taxa: a.taxa ?? null,
    p_desconto_tipo: a.descontoTipo ?? null, p_desconto_valor: a.descontoValor ?? null,
    p_desconto_percentual: a.descontoPercentual ?? null, p_motivo: a.motivo ?? null,
    p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const cancelarPedido = (
  admin: SupabaseClient,
  a: { restauranteId: string; pedidoId: string; motivo: string; atorId: string; atorNome: string },
) =>
  rpc<{ pedido: string; comanda: string }>(admin, 'pedido_mesa_cancelar', {
    p_restaurante: a.restauranteId, p_pedido: a.pedidoId, p_motivo: a.motivo, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const solicitarCancelamento = (
  admin: SupabaseClient,
  a: { restauranteId: string; pedidoId: string; itemId: string | null; motivo: string; atorId: string; atorNome: string },
) =>
  rpc<{ id: string; jaExistia: boolean }>(admin, 'cancelamento_solicitar', {
    p_restaurante: a.restauranteId, p_pedido: a.pedidoId, p_item: a.itemId, p_motivo: a.motivo,
    p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const decidirCancelamento = (
  admin: SupabaseClient,
  a: { restauranteId: string; solicitacaoId: string; aprovar: boolean; observacao: string | null; atorId: string; atorNome: string },
) =>
  rpc<{ id: string; aprovada: boolean }>(admin, 'cancelamento_decidir', {
    p_restaurante: a.restauranteId, p_solicitacao: a.solicitacaoId, p_aprovar: a.aprovar, p_obs: a.observacao,
    p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const estornarPagamento = (
  admin: SupabaseClient,
  a: { restauranteId: string; pagamentoId: string; motivo: string; atorNome: string },
) =>
  rpc<null>(admin, 'comanda_estornar_pagamento', {
    p_restaurante: a.restauranteId, p_pagamento: a.pagamentoId, p_motivo: a.motivo, p_ator_nome: a.atorNome,
  })

export interface ResultadoFechamento {
  total: number
  pago: number
  subtotal: number
  taxa: number
  desconto: number
  taxa_percentual: number
  taxa_padrao: number
  taxa_situacao: 'aceita' | 'removida' | 'alterada' | 'sem_taxa'
}

export const fecharConta = (admin: SupabaseClient, a: { restauranteId: string; comandaId: string; atorId: string; atorNome: string }) =>
  rpc<ResultadoFechamento>(admin, 'comanda_fechar', {
    p_restaurante: a.restauranteId, p_comanda: a.comandaId, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const transferirMesa = (
  admin: SupabaseClient,
  a: {
    restauranteId: string; origemMesaId: string; destinoMesaId: string; mesclar: boolean; atorId: string; atorNome: string
    motivo: string
  },
) =>
  rpc<{ comanda: string; mesclou: boolean }>(admin, 'mesa_transferir', {
    p_restaurante: a.restauranteId, p_origem: a.origemMesaId, p_destino: a.destinoMesaId, p_mesclar: a.mesclar,
    p_ator: a.atorId, p_ator_nome: a.atorNome, p_motivo: a.motivo,
  })

export const transferirItens = (
  admin: SupabaseClient,
  a: {
    restauranteId: string; itemIds: string[]; destinoMesaId: string; atorId: string; atorNome: string
    /** Quanto de cada linha vai (mesma ordem de `itemIds`). Ausente = a linha inteira. */
    quantidades?: number[] | null
    motivo: string
  },
) =>
  rpc<{ comanda: string; itens: number }>(admin, 'itens_transferir', {
    p_restaurante: a.restauranteId, p_itens: a.itemIds, p_destino: a.destinoMesaId, p_ator: a.atorId,
    p_ator_nome: a.atorNome, p_quantidades: a.quantidades ?? null, p_motivo: a.motivo,
  })

export const cancelarComanda = (
  admin: SupabaseClient,
  a: { restauranteId: string; comandaId: string; motivo: string; atorId: string; atorNome: string },
) =>
  rpc<{ comanda: string; lancamentos_cancelados: number }>(admin, 'comanda_cancelar', {
    p_restaurante: a.restauranteId, p_comanda: a.comandaId, p_motivo: a.motivo, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const cancelarItem = (admin: SupabaseClient, a: { restauranteId: string; itemId: string; motivo: string; atorNome: string }) =>
  rpc<{ pedido: string; pedido_cancelado: boolean }>(admin, 'item_cancelar', {
    p_restaurante: a.restauranteId, p_item: a.itemId, p_motivo: a.motivo, p_ator_nome: a.atorNome,
  })

// ── histórico ───────────────────────────────────────────────────────────────

export interface EventoHistorico {
  quando: string
  quem: string
  oQue: string
}

/** Linha do tempo da conta aberta: eventos auditados da comanda e dos lançamentos dela. */
export async function historicoDaConta(admin: SupabaseClient, restauranteId: string, conta: ContaDaMesa): Promise<EventoHistorico[]> {
  // Conta que absorveu outra (junção de mesas) mostra também o que aconteceu na de origem:
  // pagamentos e ajustes feitos lá continuam fazendo parte desta conta.
  const { data: absorvidas } = await admin
    .from('comandas')
    .select('id')
    .eq('restaurante_id', restauranteId)
    .eq('transferida_para', conta.comandaId)
  const ids = [conta.comandaId, ...((absorvidas ?? []) as { id: string }[]).map((c) => c.id), ...conta.lancamentos.map((l) => l.id)]
  const { data } = await admin
    .from('eventos_auditoria')
    .select('acao, usuario_nome, criado_em, dados')
    .eq('restaurante_id', restauranteId)
    .in('entidade_id', ids)
    .order('criado_em', { ascending: false })
    .limit(100)

  return ((data ?? []) as { acao: string; usuario_nome: string; criado_em: string; dados: Record<string, unknown> | null }[]).map((e) => {
    return { quando: e.criado_em, quem: e.usuario_nome, oQue: `${ROTULO_EVENTO[e.acao] ?? e.acao}${detalheDoEvento(e.dados)}` }
  })
}

/**
 * O "de quê" de um evento, para a linha do tempo. Eventos da aplicação trazem `resumo`;
 * os gravados pelas funções do banco trazem `de`/`para` e `motivo`.
 */
export function detalheDoEvento(dados: Record<string, unknown> | null | undefined): string {
  if (!dados) return ''
  const partes: string[] = []
  if (dados.resumo) partes.push(String(dados.resumo))
  else if (dados.de !== undefined && dados.para !== undefined) partes.push(`${String(dados.de)} → ${String(dados.para)}`)
  if (dados.motivo && !String(dados.resumo ?? '').includes(String(dados.motivo))) partes.push(String(dados.motivo))
  return partes.length ? ` — ${partes.join(' · ')}` : ''
}
