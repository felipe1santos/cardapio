import type { SupabaseClient } from '@supabase/supabase-js'
import { mensagemDeErroConta, type FormaPagamento } from '@/lib/conta'

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
}

export interface ContaDaMesa {
  comandaId: string
  abertaEm: string
  pessoas: number | null
  observacoes: string | null
  responsavelNome: string | null
  taxaServicoPercentual: number
  descontoValor: number
  descontoMotivo: string | null
  totais: TotaisConta
  lancamentos: LancamentoDaConta[]
  pagamentos: PagamentoDaConta[]
}

export type ResultadoOp<T = unknown> = { ok: true; valor: T } | { ok: false; erro: string; codigo: string }

function codigoDo(message: string | undefined): string {
  return (message ?? '').replace(/^[\s\S]*?(\w+)(:[\d.]+)?$/, '$1')
}

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ResultadoOp<T>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) return { ok: false, erro: mensagemDeErroConta(error.message), codigo: codigoDo(error.message) }
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
    .select('id, aberta_em, pessoas, observacoes, responsavel_nome, taxa_servico_percentual, desconto_valor, desconto_motivo')
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .eq('status', 'aberta')
    .maybeSingle()
  if (!c) return null
  const comanda = c as {
    id: string; aberta_em: string; pessoas: number | null; observacoes: string | null; responsavel_nome: string | null
    taxa_servico_percentual: number; desconto_valor: number; desconto_motivo: string | null
  }

  const [{ data: t }, { data: peds }, { data: pags }] = await Promise.all([
    admin.rpc('comanda_totais', { p_comanda: comanda.id }),
    admin
      .from('pedidos')
      .select('id, numero, status, total, criado_em, criado_por_nome, impresso, pedido_itens ( id, nome, quantidade, preco_unitario, complementos, observacao, cancelado_em, cancelado_motivo, cancelado_por_nome )')
      .eq('comanda_id', comanda.id)
      .order('criado_em', { ascending: true }),
    admin
      .from('pagamentos_comanda')
      .select('id, forma, valor, valor_recebido, troco, criado_por_nome, criado_em, estornado_em, estorno_motivo, estornado_por_nome')
      .eq('comanda_id', comanda.id)
      .order('criado_em', { ascending: true }),
  ])

  const tot = ((t as unknown[] | null) ?? [])[0] as Record<string, string | number> | undefined

  return {
    comandaId: comanda.id,
    abertaEm: comanda.aberta_em,
    pessoas: comanda.pessoas,
    observacoes: comanda.observacoes,
    responsavelNome: comanda.responsavel_nome,
    taxaServicoPercentual: Number(comanda.taxa_servico_percentual),
    descontoValor: Number(comanda.desconto_valor),
    descontoMotivo: comanda.desconto_motivo,
    totais: {
      subtotal: Number(tot?.subtotal ?? 0),
      taxaServico: Number(tot?.taxa_servico ?? 0),
      desconto: Number(tot?.desconto ?? 0),
      total: Number(tot?.total ?? 0),
      pago: Number(tot?.pago ?? 0),
      restante: Number(tot?.restante ?? 0),
    },
    lancamentos: ((peds ?? []) as unknown as {
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
    })),
    pagamentos: ((pags ?? []) as unknown as {
      id: string; forma: FormaPagamento; valor: number; valor_recebido: number | null; troco: number; criado_por_nome: string
      criado_em: string; estornado_em: string | null; estorno_motivo: string | null; estornado_por_nome: string | null
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
    })),
  }
}

// ── operações (funções da 0067) ─────────────────────────────────────────────

export const registrarPagamento = (
  admin: SupabaseClient,
  a: { restauranteId: string; comandaId: string; forma: FormaPagamento; valor: number; recebido: number | null; chave: string; atorId: string; atorNome: string },
) =>
  rpc<{ id: string; idempotente: boolean; troco?: number }>(admin, 'comanda_registrar_pagamento', {
    p_restaurante: a.restauranteId, p_comanda: a.comandaId, p_forma: a.forma, p_valor: a.valor,
    p_recebido: a.recebido, p_chave: a.chave, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const estornarPagamento = (
  admin: SupabaseClient,
  a: { restauranteId: string; pagamentoId: string; motivo: string; atorNome: string },
) =>
  rpc<null>(admin, 'comanda_estornar_pagamento', {
    p_restaurante: a.restauranteId, p_pagamento: a.pagamentoId, p_motivo: a.motivo, p_ator_nome: a.atorNome,
  })

export const fecharConta = (admin: SupabaseClient, a: { restauranteId: string; comandaId: string; atorId: string; atorNome: string }) =>
  rpc<{ total: number; pago: number }>(admin, 'comanda_fechar', {
    p_restaurante: a.restauranteId, p_comanda: a.comandaId, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const transferirMesa = (
  admin: SupabaseClient,
  a: { restauranteId: string; origemMesaId: string; destinoMesaId: string; mesclar: boolean; atorId: string; atorNome: string },
) =>
  rpc<{ comanda: string; mesclou: boolean }>(admin, 'mesa_transferir', {
    p_restaurante: a.restauranteId, p_origem: a.origemMesaId, p_destino: a.destinoMesaId, p_mesclar: a.mesclar,
    p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const transferirItens = (
  admin: SupabaseClient,
  a: {
    restauranteId: string; itemIds: string[]; destinoMesaId: string; atorId: string; atorNome: string
    /** Quanto de cada linha vai (mesma ordem de `itemIds`). Ausente = a linha inteira. */
    quantidades?: number[] | null
  },
) =>
  rpc<{ comanda: string; itens: number }>(admin, 'itens_transferir', {
    p_restaurante: a.restauranteId, p_itens: a.itemIds, p_destino: a.destinoMesaId, p_ator: a.atorId,
    p_ator_nome: a.atorNome, p_quantidades: a.quantidades ?? null,
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

const ROTULO_ACAO: Record<string, string> = {
  'mesa.enviou_cozinha': 'Enviou lançamento para a cozinha',
  'mesa.transferiu': 'Transferiu a mesa',
  'mesa.mesclou': 'Juntou a conta com outra mesa',
  'mesa.transferiu_itens': 'Transferiu itens para esta mesa',
  'conta.pagamento': 'Registrou pagamento',
  'conta.estorno': 'Estornou pagamento',
  'conta.fechou': 'Fechou a conta',
  'conta.ajustou': 'Ajustou a conta',
  'conta.cancelou_item': 'Cancelou item',
  'conta.cancelou_pedido': 'Cancelou lançamento',
  'conta.cancelou_comanda': 'Cancelou a conta',
  'conta.reimprimiu': 'Pediu reimpressão',
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
    const detalhe = e.dados?.resumo ? ` — ${String(e.dados.resumo)}` : ''
    return { quando: e.criado_em, quem: e.usuario_nome, oQue: `${ROTULO_ACAO[e.acao] ?? e.acao}${detalhe}` }
  })
}
