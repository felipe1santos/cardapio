import type { SupabaseClient } from '@supabase/supabase-js'
import { mensagemDeErroConta, formatarResumoPagamento, ehFormaOferecida, type FormaPagamento } from '@/lib/conta'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarPedido, type NovoPedidoItemInput } from '@/lib/queries/pedidos'
import { montarHistorico, type EventoHistorico } from '@/lib/queries/conta'
import { validarOpcoes, type GrupoOpcoesRegra } from '@/lib/opcoes-item'
import { situacaoFinanceira, type TipoComanda, type EntregaManual, type DecisaoFechamento, type PagamentoFechamento } from '@/lib/pdv-v2'
import { resolverFrete } from '@/lib/frete'
import { processarFidelidadeComandaFechada } from '@/lib/fidelidade'
import { validarCupom, type CupomRegra } from '@/lib/fidelidade-regras'
import { buscarHistoricoCliente, hojeSaoPaulo, normalizarCodigoCupom } from '@/lib/queries/fidelidade'

/**
 * Serviço único da conta presencial — PDV (mesa e balcão) e salão usam as mesmas
 * operações. Server-only, sempre com service_role e SEMPRE com a loja da sessão.
 *
 * Regras de dinheiro e estado vivem nas funções do banco (0085). Aqui: montar a
 * leitura, chamar a função certa, traduzir o erro e auditar o que a função não
 * audita por dentro.
 */

export type Origem = 'pdv' | 'salao'

export interface Ator {
  restauranteId: string
  userId: string
  nome: string
  papel: string
}

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; erro: string; codigo: string; detalhe: string; status: number }

/** Códigos que são conflito de estado (409), não erro de quem chamou (400). */
const CONFLITO = new Set([
  'comanda_nao_aberta', 'conflito_status', 'pendencias_abertas', 'cancelamento_pendente', 'saldo_restante',
  'pagamento_excede_total', 'ajuste_financeiro_necessario', 'solicitacao_decidida', 'ja_cancelado',
  'chave_em_outra_comanda', 'mesa_ocupada', 'comanda_nao_fechada', 'pedido_nao_pronto', 'valor_acima_do_restante',
  'comanda_sem_nome', 'mesa_em_limpeza', 'mesa_indisponivel', 'cupom_esgotado', 'cupom_ja_usado',
])

export function traduzirErro(bruto: string | undefined): { codigo: string; detalhe: string; erro: string; status: number } {
  const texto = (bruto ?? '').trim()
  const m = /^([a-z][a-z_]*)(?::(.*))?$/.exec(texto)
  const codigo = m?.[1] ?? ''
  const detalhe = m?.[2] ?? ''
  const status = codigo === 'cancelamento_requer_gestao' ? 403 : CONFLITO.has(codigo) ? 409 : codigo ? 400 : 500
  return { codigo, detalhe, erro: mensagemDeErroConta(texto), status }
}

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Resultado<T>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) {
    // Log com o código cru (nunca dados do cliente): a tela recebe a frase traduzida.
    console.error(`[conta-presencial] ${fn}:`, error.message)
    return { ok: false, ...traduzirErro(error.message) }
  }
  return { ok: true, valor: data as T }
}

const falha = (erro: string, status = 400, codigo = 'invalido'): { ok: false; erro: string; codigo: string; detalhe: string; status: number } => ({
  ok: false, erro, codigo, detalhe: '', status,
})

// ─── leitura ────────────────────────────────────────────────────────────────

export interface ItemConta {
  id: string
  nome: string
  quantidade: number
  precoUnitario: number
  complementos: string[]
  detalhe: string
  observacao: string | null
  cancelado: boolean
  canceladoMotivo: string | null
}

export interface PedidoConta {
  id: string
  numero: number
  status: string
  atendimentoStatus: string | null
  total: number
  criadoEm: string
  preparandoEm: string | null
  prontoEm: string | null
  atendidoEm: string | null
  atendidoPorNome: string | null
  criadoPorNome: string | null
  impresso: boolean
  resolvidoForcado: boolean
  canceladoMotivo: string | null
  itens: ItemConta[]
}

export interface PagamentoConta {
  id: string
  forma: FormaPagamento
  valor: number
  valorRecebido: number | null
  troco: number
  canal: string
  origem: string
  criadoPorNome: string
  criadoEm: string
  estornado: boolean
  estornoMotivo: string | null
  estornadoPorNome: string | null
  observacao: string | null
}

export interface ContaPresencial {
  id: string
  tipo: TipoComanda
  status: 'aberta' | 'fechada' | 'transferida' | 'cancelada'
  numero: number | null
  senha: number | null
  clienteNome: string | null
  clienteTelefone: string | null
  /** Cadastro da loja vinculado pelo telefone (0094). */
  clienteVinculado: boolean
  /** Conta de mesa antiga aberta sem nome: pede o nome antes de lançar ou fechar. */
  semNome: boolean
  entrega: (Omit<EntregaManual, 'taxaInformada'> & { taxa: number; taxaManual: boolean }) | null
  cupomCodigo: string | null
  mesaId: string | null
  mesaNome: string | null
  abertaEm: string
  abertaPorNome: string | null
  responsavelNome: string | null
  pessoas: number | null
  fechadaEm: string | null
  fechadaPorNome: string | null
  reabertaEm: string | null
  reabertaPorNome: string | null
  taxaServicoPercentual: number
  descontoTipo: 'valor' | 'percentual'
  descontoValor: number
  descontoPercentual: number
  descontoMotivo: string | null
  totais: { subtotal: number; taxaServico: number; desconto: number; total: number; pago: number; restante: number }
  situacao: ReturnType<typeof situacaoFinanceira>
  pedidos: PedidoConta[]
  pagamentos: PagamentoConta[]
  solicitacoes: { id: string; pedidoId: string; itemId: string | null; descricao: string; motivo: string; solicitadoPorNome: string; solicitadoEm: string }[]
}

const COMANDA_COLS =
  'id, tipo, status, numero, senha, cliente_nome, cliente_telefone, cliente_id, entrega, entrega_cep, entrega_rua, entrega_numero, entrega_complemento, entrega_bairro, entrega_cidade, entrega_referencia, entrega_observacao, taxa_entrega, taxa_entrega_manual, cupom_codigo, mesa_id, aberta_em, aberta_por_nome, responsavel_nome, pessoas, fechada_em, fechada_por_nome, reaberta_em, reaberta_por_nome, taxa_servico_percentual, desconto_tipo, desconto_valor, desconto_percentual, desconto_motivo, mesas ( nome )'

export async function buscarConta(admin: SupabaseClient, restauranteId: string, comandaId: string): Promise<ContaPresencial | null> {
  const { data: c } = await admin.from('comandas').select(COMANDA_COLS).eq('id', comandaId).eq('restaurante_id', restauranteId).maybeSingle()
  if (!c) return null
  const row = c as unknown as Record<string, unknown> & { mesas: { nome: string } | { nome: string }[] | null }
  const mesa = Array.isArray(row.mesas) ? row.mesas[0] : row.mesas

  const [{ data: t }, { data: peds }, { data: pags }, { data: sols }] = await Promise.all([
    admin.rpc('comanda_totais', { p_comanda: comandaId }),
    admin
      .from('pedidos')
      .select('id, numero, status, atendimento_status, total, criado_em, preparando_em, pronto_em, atendido_em, atendido_por_nome, criado_por_nome, impresso, resolvido_forcado, cancelado_observacao, pedido_itens ( id, nome, quantidade, preco_unitario, complementos, tamanho_nome, sabor_nome, borda_nome, massa_nome, observacao, cancelado_em, cancelado_motivo )')
      .eq('comanda_id', comandaId)
      .eq('restaurante_id', restauranteId)
      .order('criado_em', { ascending: true }),
    admin
      .from('pagamentos_comanda')
      .select('id, forma, valor, valor_recebido, troco, canal, origem, criado_por_nome, criado_em, estornado_em, estorno_motivo, estornado_por_nome, observacao')
      .eq('comanda_id', comandaId)
      .order('criado_em', { ascending: true }),
    admin
      .from('solicitacoes_cancelamento')
      .select('id, pedido_id, pedido_item_id, motivo, solicitado_por_nome, solicitado_em, pedidos!inner ( comanda_id )')
      .eq('restaurante_id', restauranteId)
      .eq('status', 'pendente')
      .eq('pedidos.comanda_id', comandaId)
      .order('solicitado_em', { ascending: true }),
  ])
  const tot = ((t as unknown[] | null) ?? [])[0] as Record<string, string | number> | undefined

  const pedidos: PedidoConta[] = ((peds ?? []) as unknown as {
    id: string; numero: number; status: string; atendimento_status: string | null; total: number; criado_em: string
    preparando_em: string | null; pronto_em: string | null; atendido_em: string | null; atendido_por_nome: string | null
    criado_por_nome: string | null; impresso: boolean; resolvido_forcado: boolean; cancelado_observacao: string | null
    pedido_itens: {
      id: string; nome: string; quantidade: number; preco_unitario: number; complementos: { nome: string }[] | null
      tamanho_nome: string | null; sabor_nome: string | null; borda_nome: string | null; massa_nome: string | null
      observacao: string | null; cancelado_em: string | null; cancelado_motivo: string | null
    }[]
  }[]).map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    atendimentoStatus: p.atendimento_status,
    total: Number(p.total),
    criadoEm: p.criado_em,
    preparandoEm: p.preparando_em,
    prontoEm: p.pronto_em,
    atendidoEm: p.atendido_em,
    atendidoPorNome: p.atendido_por_nome,
    criadoPorNome: p.criado_por_nome,
    impresso: p.impresso,
    resolvidoForcado: p.resolvido_forcado,
    canceladoMotivo: p.cancelado_observacao,
    itens: (p.pedido_itens ?? []).map((i) => ({
      id: i.id,
      nome: i.nome,
      quantidade: i.quantidade,
      precoUnitario: Number(i.preco_unitario),
      complementos: (i.complementos ?? []).map((x) => x.nome),
      detalhe: [i.tamanho_nome, i.sabor_nome, i.borda_nome ? `Borda ${i.borda_nome}` : '', i.massa_nome ? `Massa ${i.massa_nome}` : '']
        .filter(Boolean)
        .join(' · '),
      observacao: i.observacao || null,
      cancelado: i.cancelado_em !== null,
      canceladoMotivo: i.cancelado_motivo,
    })),
  }))

  const pagamentos: PagamentoConta[] = ((pags ?? []) as unknown as {
    id: string; forma: FormaPagamento; valor: number; valor_recebido: number | null; troco: number; canal: string; origem: string
    criado_por_nome: string; criado_em: string; estornado_em: string | null; estorno_motivo: string | null; estornado_por_nome: string | null
    observacao: string | null
  }[]).map((p) => ({
    id: p.id,
    forma: p.forma,
    valor: Number(p.valor),
    valorRecebido: p.valor_recebido === null ? null : Number(p.valor_recebido),
    troco: Number(p.troco),
    canal: p.canal,
    origem: p.origem,
    criadoPorNome: p.criado_por_nome,
    criadoEm: p.criado_em,
    estornado: p.estornado_em !== null,
    estornoMotivo: p.estorno_motivo,
    estornadoPorNome: p.estornado_por_nome,
    observacao: p.observacao,
  }))

  const descrever = (pedidoId: string, itemId: string | null) => {
    const ped = pedidos.find((p) => p.id === pedidoId)
    if (!ped) return 'Pedido'
    if (!itemId) return `Pedido #${ped.numero} inteiro`
    const it = ped.itens.find((i) => i.id === itemId)
    return it ? `${it.quantidade}× ${it.nome} (#${ped.numero})` : `Item do pedido #${ped.numero}`
  }

  const totais = {
    subtotal: Number(tot?.subtotal ?? 0),
    taxaServico: Number(tot?.taxa_servico ?? 0),
    desconto: Number(tot?.desconto ?? 0),
    total: Number(tot?.total ?? 0),
    pago: Number(tot?.pago ?? 0),
    restante: Number(tot?.restante ?? 0),
  }

  return {
    id: row.id as string,
    tipo: row.tipo as TipoComanda,
    status: row.status as ContaPresencial['status'],
    numero: (row.numero as number | null) ?? null,
    senha: (row.senha as number | null) ?? null,
    clienteNome: (row.cliente_nome as string | null) ?? null,
    clienteTelefone: (row.cliente_telefone as string | null) ?? null,
    clienteVinculado: row.cliente_id !== null && row.cliente_id !== undefined,
    semNome: row.tipo === 'mesa' && !String(row.cliente_nome ?? '').trim(),
    entrega: row.entrega === true
      ? {
          cep: (row.entrega_cep as string | null) ?? '',
          rua: (row.entrega_rua as string | null) ?? '',
          numero: (row.entrega_numero as string | null) ?? '',
          complemento: (row.entrega_complemento as string | null) ?? '',
          bairro: (row.entrega_bairro as string | null) ?? '',
          cidade: (row.entrega_cidade as string | null) ?? '',
          referencia: (row.entrega_referencia as string | null) ?? '',
          observacao: (row.entrega_observacao as string | null) ?? '',
          taxa: Number(row.taxa_entrega ?? 0),
          taxaManual: row.taxa_entrega_manual === true,
        }
      : null,
    cupomCodigo: (row.cupom_codigo as string | null) ?? null,
    mesaId: (row.mesa_id as string | null) ?? null,
    mesaNome: mesa?.nome ?? null,
    abertaEm: row.aberta_em as string,
    abertaPorNome: (row.aberta_por_nome as string | null) ?? null,
    responsavelNome: (row.responsavel_nome as string | null) ?? null,
    pessoas: (row.pessoas as number | null) ?? null,
    fechadaEm: (row.fechada_em as string | null) ?? null,
    fechadaPorNome: (row.fechada_por_nome as string | null) ?? null,
    reabertaEm: (row.reaberta_em as string | null) ?? null,
    reabertaPorNome: (row.reaberta_por_nome as string | null) ?? null,
    taxaServicoPercentual: Number(row.taxa_servico_percentual),
    descontoTipo: row.desconto_tipo === 'percentual' ? 'percentual' : 'valor',
    descontoValor: Number(row.desconto_valor),
    descontoPercentual: Number(row.desconto_percentual ?? 0),
    descontoMotivo: (row.desconto_motivo as string | null) ?? null,
    totais,
    situacao: situacaoFinanceira(totais.total, totais.pago, pagamentos.filter((p) => p.estornado).length),
    pedidos,
    pagamentos,
    solicitacoes: ((sols ?? []) as unknown as {
      id: string; pedido_id: string; pedido_item_id: string | null; motivo: string; solicitado_por_nome: string; solicitado_em: string
    }[]).map((s) => ({
      id: s.id,
      pedidoId: s.pedido_id,
      itemId: s.pedido_item_id,
      descricao: descrever(s.pedido_id, s.pedido_item_id),
      motivo: s.motivo,
      solicitadoPorNome: s.solicitado_por_nome,
      solicitadoEm: s.solicitado_em,
    })),
  }
}

export async function historicoDaContaPresencial(admin: SupabaseClient, restauranteId: string, conta: ContaPresencial): Promise<EventoHistorico[]> {
  const ids = [conta.id, ...conta.pedidos.map((p) => p.id)]
  const { data } = await admin
    .from('eventos_auditoria')
    .select('acao, usuario_nome, criado_em, dados, entidade_id')
    .eq('restaurante_id', restauranteId)
    .in('entidade_id', ids)
    .order('criado_em', { ascending: false })
    .limit(200)
  const linhas = (data ?? []) as { acao: string; usuario_nome: string; criado_em: string; dados: Record<string, unknown> | null; entidade_id: string | null }[]
  return montarHistorico(
    linhas,
    conta.pedidos.map((p) => ({ id: p.id, numero: p.numero, criadoEm: p.criadoEm, criadoPorNome: p.criadoPorNome })),
  )
}

// ─── Central de Balcão ──────────────────────────────────────────────────────

export interface LinhaCentral {
  id: string
  senha: number
  nome: string
  telefone: string | null
  entrega: boolean
  status: string
  abertaEm: string
  fechadaEm: string | null
  qtdPedidos: number
  total: number
  pago: number
  restante: number
  pedidos: { status: string; atendimentoStatus: string | null }[]
  estornos: number
}

/** Início do dia em São Paulo, em ISO — o "hoje" do operador, não o do servidor. */
export function inicioDoDiaSaoPaulo(agora = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
  return new Date(`${partes}T00:00:00-03:00`).toISOString()
}

export async function listarCentralBalcao(
  admin: SupabaseClient,
  restauranteId: string,
  escopo: 'abertas' | 'hoje',
): Promise<{ linhas: LinhaCentral[]; recebidoHoje: number; abertas: number }> {
  const desde = inicioDoDiaSaoPaulo()
  let q = admin
    .from('comandas')
    .select('id, senha, cliente_nome, cliente_telefone, entrega, status, aberta_em, fechada_em')
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'balcao')
    .order('aberta_em', { ascending: true })
    .limit(200)
  q = escopo === 'abertas' ? q.eq('status', 'aberta') : q.neq('status', 'aberta').gte('fechada_em', desde)
  const { data: comandas, error } = await q
  if (error) throw error
  const lista = (comandas ?? []) as { id: string; senha: number; cliente_nome: string; cliente_telefone: string | null; entrega: boolean; status: string; aberta_em: string; fechada_em: string | null }[]
  const ids = lista.map((c) => c.id)

  const [{ data: peds }, { data: pags }, { count: abertas }, { data: hoje }] = await Promise.all([
    ids.length
      ? admin.from('pedidos').select('comanda_id, status, atendimento_status').eq('restaurante_id', restauranteId).in('comanda_id', ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? admin.from('pagamentos_comanda').select('comanda_id, valor, estornado_em').eq('restaurante_id', restauranteId).in('comanda_id', ids)
      : Promise.resolve({ data: [] }),
    admin.from('comandas').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId).eq('tipo', 'balcao').eq('status', 'aberta'),
    admin.from('pagamentos_comanda').select('valor').eq('restaurante_id', restauranteId).eq('canal', 'balcao').is('estornado_em', null).gte('criado_em', desde),
  ])
  const totais = await Promise.all(ids.map((id) => admin.rpc('comanda_totais', { p_comanda: id })))

  const linhas = lista.map((c, i) => {
    const tot = ((totais[i]?.data as unknown[] | null) ?? [])[0] as Record<string, number> | undefined
    const doPedido = ((peds ?? []) as { comanda_id: string; status: string; atendimento_status: string | null }[]).filter((p) => p.comanda_id === c.id)
    const dosPags = ((pags ?? []) as { comanda_id: string; estornado_em: string | null }[]).filter((p) => p.comanda_id === c.id)
    return {
      id: c.id,
      senha: c.senha,
      nome: c.cliente_nome,
      telefone: c.cliente_telefone,
      entrega: c.entrega === true,
      status: c.status,
      abertaEm: c.aberta_em,
      fechadaEm: c.fechada_em,
      qtdPedidos: doPedido.filter((p) => p.status !== 'cancelado').length,
      total: Number(tot?.total ?? 0),
      pago: Number(tot?.pago ?? 0),
      restante: Number(tot?.restante ?? 0),
      pedidos: doPedido.map((p) => ({ status: p.status, atendimentoStatus: p.atendimento_status })),
      estornos: dosPags.filter((p) => p.estornado_em !== null).length,
    }
  })
  const recebidoHoje = ((hoje ?? []) as { valor: number }[]).reduce((s, p) => s + Number(p.valor), 0)
  return { linhas, recebidoHoje: Math.round(recebidoHoje * 100) / 100, abertas: abertas ?? 0 }
}

// ─── ações ──────────────────────────────────────────────────────────────────

function auditar(admin: SupabaseClient, ator: Ator, acao: string, entidade: string, entidadeId: string, dados: Record<string, unknown>) {
  return registrarAuditoria(admin, {
    restauranteId: ator.restauranteId,
    usuarioId: ator.userId,
    usuarioNome: ator.nome,
    acao,
    entidade,
    entidadeId,
    dados,
  })
}

/**
 * Card preto "Balcão": venda rápida, pedido avulso, pedido por telefone e — com os dados
 * de entrega preenchidos — entrega manual. Sem taxa digitada, a taxa sai da tabela de
 * frete da loja (a mesma regra do delivery); com taxa digitada, fica marcada como manual
 * na conta e na auditoria.
 */
export async function abrirBalcao(
  admin: SupabaseClient,
  ator: Ator,
  a: { nome: string; telefone: string | null; chave: string; entrega: EntregaManual | null },
  origem: Origem = 'pdv',
): Promise<Resultado<{ id: string; senha: number; numero: number; idempotente: boolean }>> {
  let entrega: Record<string, unknown> | null = null
  if (a.entrega) {
    const e = a.entrega
    let taxa = e.taxaInformada
    const manual = taxa !== null
    if (taxa === null) {
      const frete = await resolverFrete(admin, ator.restauranteId, { cep: e.cep, rua: e.rua, numero: e.numero, bairro: e.bairro, cidade: e.cidade },
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)
      if (!frete.entregavel) {
        return falha(`${frete.motivo || 'A tabela de frete da loja não cobre este endereço.'} Informe a taxa de entrega manualmente.`, 400, 'frete_nao_entregavel')
      }
      taxa = frete.taxa
    }
    entrega = {
      cep: e.cep, rua: e.rua, numero: e.numero, complemento: e.complemento, bairro: e.bairro, cidade: e.cidade,
      referencia: e.referencia, observacao: e.observacao, taxa, taxa_manual: manual,
    }
  }
  return rpc<{ id: string; senha: number; numero: number; idempotente: boolean }>(admin, 'comanda_balcao_abrir', {
    p_restaurante: ator.restauranteId, p_nome: a.nome, p_telefone: a.telefone, p_ator: ator.userId, p_ator_nome: ator.nome,
    p_chave: a.chave, p_entrega: entrega, p_origem: origem,
  })
}

/**
 * Abre o atendimento de uma mesa livre: nome obrigatório, telefone opcional. A mesa é
 * travada no banco — dois operadores ao mesmo tempo: o segundo recebe `mesa_ocupada`
 * com a conta do primeiro, nunca uma segunda sessão.
 */
export async function abrirMesa(
  admin: SupabaseClient,
  ator: Ator,
  mesaId: string,
  a: { nome: string; telefone: string | null; chave: string },
  origem: Origem,
): Promise<Resultado<{ id: string; numero: number; idempotente: boolean }>> {
  const r = await rpc<{ id: string; numero: number; idempotente: boolean }>(admin, 'comanda_mesa_abrir', {
    p_restaurante: ator.restauranteId, p_mesa: mesaId, p_nome: a.nome, p_telefone: a.telefone, p_ator: ator.userId,
    p_ator_nome: ator.nome, p_chave: a.chave, p_origem: origem,
  })
  if (!r.ok && r.codigo === 'mesa_ocupada') {
    return { ...r, erro: 'Outro operador acabou de abrir esta mesa. A conta dele foi aberta na tela.' }
  }
  if (!r.ok && r.codigo === 'mesa_inexistente') return { ...r, status: 404 }
  return r
}

/** Corrige nome/telefone do atendimento (auditado; nunca grava o telefone na auditoria). */
export async function identificar(admin: SupabaseClient, ator: Ator, comandaId: string, a: { nome: string; telefone: string | null }, origem: Origem) {
  return rpc<{ id: string; idempotente: boolean }>(admin, 'comanda_identificar', {
    p_restaurante: ator.restauranteId, p_comanda: comandaId, p_nome: a.nome, p_telefone: a.telefone, p_ator: ator.userId,
    p_ator_nome: ator.nome, p_origem: origem,
  })
}

/** Mesa em limpeza → livre (ou volta a mostrar bloqueio/desativação, que têm prioridade). */
export async function liberarMesa(admin: SupabaseClient, ator: Ator, mesaId: string, origem: Origem) {
  const r = await rpc<{ id: string; idempotente: boolean; estado: string }>(admin, 'mesa_liberar', {
    p_restaurante: ator.restauranteId, p_mesa: mesaId, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
  if (!r.ok && r.codigo === 'mesa_inexistente') return { ...r, status: 404 }
  return r
}

/** Grupos obrigatórios conferidos no servidor — mesma regra do lançamento do salão. */
async function conferirOpcoes(admin: SupabaseClient, itens: NovoPedidoItemInput[]): Promise<string | null> {
  const ids = [...new Set(itens.map((i) => i.itemId))]
  const { data, error } = await admin
    .from('grupos_item_complementos')
    .select('item_id, nome, obrigatorio, min_escolhas, max_escolhas, item_complementos ( nome, pausado )')
    .in('item_id', ids)
  if (error) return 'Erro ao conferir as opções.'
  const porItem = new Map<string, GrupoOpcoesRegra[]>()
  for (const g of (data ?? []) as unknown as {
    item_id: string; nome: string; obrigatorio: boolean; min_escolhas: number; max_escolhas: number
    item_complementos: { nome: string; pausado: boolean | null }[]
  }[]) {
    const lista = porItem.get(g.item_id) ?? []
    lista.push({
      nome: g.nome,
      obrigatorio: g.obrigatorio,
      minEscolhas: g.min_escolhas,
      maxEscolhas: g.max_escolhas,
      opcoes: (g.item_complementos ?? []).filter((c) => !c.pausado).map((c) => c.nome),
    })
    porItem.set(g.item_id, lista)
  }
  for (const linha of itens) {
    // Item sem grupo cadastrado: complementos avulsos são reprecificados por nome em
    // criarPedido e o nome desconhecido é descartado lá. Só valida quem tem grupo.
    const grupos = porItem.get(linha.itemId)
    if (!grupos || grupos.length === 0) continue
    const erros = validarOpcoes(grupos, linha.complementos ?? [])
    if (erros.length > 0) return erros[0]
  }
  return null
}

/**
 * Lança itens numa comanda. `alvo.comandaId` = comanda existente (balcão ou mesa);
 * `alvo.mesaId` = mesa, com a comanda criada no primeiro lançamento (como no salão).
 * Preço recalculado do catálogo (criarPedido); gravação atômica (comanda_lancar).
 */
export async function lancar(
  admin: SupabaseClient,
  ator: Ator,
  alvo: { comandaId?: string; mesaId?: string },
  itens: NovoPedidoItemInput[],
  chave: string,
  origem: Origem,
): Promise<Resultado<{ id: string; numero: number; idempotente: boolean; comandaId: string }>> {
  const erroOpcoes = await conferirOpcoes(admin, itens)
  if (erroOpcoes) return falha(erroOpcoes)

  let comandaId = alvo.comandaId
  let tipo: TipoComanda = 'balcao'
  let mesaNome: string | null = null
  if (alvo.mesaId) {
    const { data: mesa } = await admin
      .from('mesas')
      .select('id, nome, ativa, bloqueada_em')
      .eq('id', alvo.mesaId)
      .eq('restaurante_id', ator.restauranteId)
      .maybeSingle()
    if (!mesa) return falha('Mesa não encontrada nesta loja.', 404, 'mesa_inexistente')
    if (mesa.ativa === false) return falha('Mesa desativada.', 409, 'mesa_indisponivel')
    if (mesa.bloqueada_em !== null) return falha('Mesa bloqueada.', 409, 'mesa_indisponivel')
    // PDV v2: a mesa só recebe lançamento depois de aberta com o nome do cliente
    // (abrirMesa). Nada de comanda nascer sem nome pelo lançamento.
    const { data: aberta } = await admin
      .from('comandas')
      .select('id')
      .eq('restaurante_id', ator.restauranteId)
      .eq('mesa_id', alvo.mesaId)
      .eq('status', 'aberta')
      .maybeSingle()
    if (!aberta) return falha('Abra a mesa com o nome do cliente antes de lançar.', 409, 'mesa_sem_atendimento')
    comandaId = aberta.id as string
    tipo = 'mesa'
    mesaNome = mesa.nome as string
  } else if (comandaId) {
    const { data: c } = await admin.from('comandas').select('id, tipo, status, mesas ( nome )').eq('id', comandaId).eq('restaurante_id', ator.restauranteId).maybeSingle()
    if (!c) return falha('Conta não encontrada.', 404, 'comanda_inexistente')
    if (c.status !== 'aberta') return falha('Esta conta já foi fechada.', 409, 'comanda_nao_aberta')
    tipo = c.tipo as TipoComanda
    const m = (c as unknown as { mesas: { nome: string } | { nome: string }[] | null }).mesas
    mesaNome = (Array.isArray(m) ? m[0]?.nome : m?.nome) ?? null
  } else {
    return falha('Informe a conta ou a mesa.')
  }

  let r: Resultado<{ id: string; numero: number; idempotente: boolean }> | null = null
  try {
    await criarPedido(
      admin,
      ator.restauranteId,
      {
        tipo: 'retirada',
        cliente: { nome: mesaNome ?? '', telefone: '' },
        endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
        pagamento: 'dinheiro',
        trocoPara: null,
        itens,
        origem: 'pdv',
        canal: tipo,
        mesa: mesaNome ?? undefined,
        comandaId,
        criadoPor: ator.userId,
        criadoPorNome: ator.nome,
      },
      {
        gravar: async (totais, linhas) => {
          r = await rpc<{ id: string; numero: number; idempotente: boolean }>(admin, 'comanda_lancar', {
            p_restaurante: ator.restauranteId,
            p_comanda: comandaId,
            p_pedido: { subtotal: totais.subtotal, total: totais.total, cliente_nome: mesaNome },
            p_itens: linhas,
            p_ator: ator.userId,
            p_ator_nome: ator.nome,
            p_chave: chave,
            p_lancado_via: origem,
          })
          if (!r.ok) throw new Error('__rpc__')
          return { id: r.valor.id, numero: r.valor.numero }
        },
      },
    )
  } catch (err) {
    const res = r as Resultado<unknown> | null
    if (res && !res.ok) return res
    return falha(err instanceof Error ? err.message : 'Não foi possível lançar o pedido.')
  }
  const final = r as unknown as { ok: true; valor: { id: string; numero: number; idempotente: boolean } }
  if (!final.valor.idempotente) {
    await auditar(admin, ator, tipo === 'mesa' ? 'mesa.enviou_cozinha' : 'balcao.lancou', 'pedido', final.valor.id, {
      mesa: mesaNome, numero: final.valor.numero, itens: itens.length, origem, comanda_id: comandaId,
    })
  }
  return { ok: true, valor: { ...final.valor, comandaId: comandaId! } }
}

export type AlvoConta = Pick<ContaPresencial, 'id' | 'tipo' | 'mesaNome' | 'numero' | 'senha' | 'clienteNome'>

export async function pagar(
  admin: SupabaseClient,
  ator: Ator,
  conta: AlvoConta,
  a: { forma: unknown; valor: unknown; recebido: unknown; chave: unknown; observacao: unknown },
  formasAceitas: string[],
  origem: Origem,
): Promise<Resultado<{ id: string; idempotente: boolean; troco?: number }>> {
  const forma = a.forma
  const valor = Number(a.valor)
  const recebido = a.recebido === null || a.recebido === undefined || a.recebido === '' ? null : Number(a.recebido)
  const chave = typeof a.chave === 'string' ? a.chave : ''
  const observacao = typeof a.observacao === 'string' ? a.observacao.trim().slice(0, 200) || null : null
  if (!ehFormaOferecida(forma) && !(forma === 'fiado' && formasAceitas.includes('fiado'))) {
    return falha('Forma de pagamento inválida.')
  }
  if (!formasAceitas.includes(forma as string)) return falha('A loja não aceita esta forma de pagamento.')
  if (!/^[0-9a-f-]{36}$/i.test(chave)) return falha('Chave do pagamento ausente.')
  if (!Number.isFinite(valor) || valor <= 0) return falha('Informe um valor maior que zero.')
  if (recebido !== null && !Number.isFinite(recebido)) return falha('Valor recebido inválido.')

  const r = await rpc<{ id: string; idempotente: boolean; troco?: number }>(admin, 'comanda_pagamento_registrar', {
    p_restaurante: ator.restauranteId, p_comanda: conta.id, p_forma: forma, p_valor: valor, p_recebido: recebido,
    p_chave: chave, p_ator: ator.userId, p_ator_nome: ator.nome, p_observacao: observacao, p_origem: origem,
  })
  if (r.ok && !r.valor.idempotente) {
    await auditar(admin, ator, 'conta.pagamento', 'comanda', conta.id, {
      resumo: formatarResumoPagamento(forma as FormaPagamento, valor, r.valor.troco ?? 0) + (observacao ? ` · ${observacao}` : ''),
      pagamento_id: r.valor.id, canal: conta.tipo, origem, mesa: conta.mesaNome,
    })
  }
  return r
}

export async function estornar(admin: SupabaseClient, ator: Ator, conta: ContaPresencial, pagamentoId: string, motivo: string, origem: Origem): Promise<Resultado<null>> {
  const pag = conta.pagamentos.find((p) => p.id === pagamentoId && !p.estornado)
  if (!pag) return falha('Pagamento não pertence a esta conta ou já foi estornado.', 404, 'pagamento_inexistente')
  if (!motivo.trim()) return falha('Informe o motivo do estorno.', 400, 'motivo_obrigatorio')
  const r = await rpc<null>(admin, 'comanda_estornar_pagamento', {
    p_restaurante: ator.restauranteId, p_pagamento: pagamentoId, p_motivo: motivo, p_ator_nome: ator.nome,
  })
  if (r.ok) {
    await auditar(admin, ator, 'conta.estorno', 'comanda', conta.id, {
      resumo: formatarResumoPagamento(pag.forma, pag.valor, 0), motivo, pagamento_id: pagamentoId, valor_afetado: pag.valor, origem,
    })
  }
  return r
}

export async function atender(admin: SupabaseClient, ator: Ator, pedidoId: string, origem: Origem) {
  return rpc<{ id: string; atendimento_status: string; idempotente: boolean }>(admin, 'pedido_atender', {
    p_restaurante: ator.restauranteId, p_pedido: pedidoId, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
}

export async function transicionar(admin: SupabaseClient, ator: Ator, pedidoId: string, de: string, para: string, origem: Origem) {
  return rpc<{ id: string; status: string }>(admin, 'pedido_transicionar', {
    p_restaurante: ator.restauranteId, p_pedido: pedidoId, p_de: de, p_para: para, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
}

export async function pendencias(admin: SupabaseClient, ator: Ator, comandaId: string) {
  return rpc<Record<string, unknown>>(admin, 'comanda_pendencias', { p_restaurante: ator.restauranteId, p_comanda: comandaId })
}

export async function fechar(admin: SupabaseClient, ator: Ator, conta: AlvoConta, origem: Origem) {
  const r = await rpc<Record<string, unknown>>(admin, 'comanda_fechar_presencial', {
    p_restaurante: ator.restauranteId, p_comanda: conta.id, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
  if (!r.ok) {
    // Fechamento bloqueado: a tela precisa do porquê, com cada pedido — não só da frase.
    if (r.codigo === 'pendencias_abertas' || r.codigo === 'saldo_restante' || r.codigo === 'cancelamento_pendente') {
      const p = await pendencias(admin, ator, conta.id)
      return { ...r, pendencias: p.ok ? p.valor : null }
    }
    return r
  }
  const v = r.valor as { total: number; taxa_situacao: string; taxa_percentual: number; taxa_padrao: number }
  const situacaoTaxa =
    v.taxa_situacao === 'removida' ? 'taxa de serviço removida'
      : v.taxa_situacao === 'alterada' ? `taxa de serviço alterada para ${v.taxa_percentual}% (padrão ${v.taxa_padrao}%)`
        : v.taxa_situacao === 'aceita' ? `taxa de serviço de ${v.taxa_percentual}% aceita`
          : 'sem taxa de serviço'
  await processarFidelidadeComandaFechada(admin, ator.restauranteId, conta.id)
  await auditar(admin, ator, 'conta.fechou', 'comanda', conta.id, {
    resumo: `total R$ ${Number(v.total).toFixed(2)} · ${situacaoTaxa}` + (conta.tipo === 'balcao' ? ` · Senha ${conta.senha} · ${conta.clienteNome}` : ''),
    de: 'aberta', para: 'fechada', taxa_situacao: v.taxa_situacao, numero: conta.numero, canal: conta.tipo, origem, mesa: conta.mesaNome,
  })
  return r
}

export async function resolver(
  admin: SupabaseClient,
  ator: Ator,
  conta: ContaPresencial,
  a: { acoes: unknown[]; motivo: string; fechar: boolean },
  origem: Origem,
) {
  const r = await rpc<{ aplicadas: number; fechamento: Record<string, unknown> | null; erro_fechamento: string | null }>(admin, 'comanda_resolver_pendencias', {
    p_restaurante: ator.restauranteId, p_comanda: conta.id, p_acoes: a.acoes, p_motivo: a.motivo, p_ator: ator.userId,
    p_ator_nome: ator.nome, p_papel: ator.papel, p_origem: origem, p_fechar: a.fechar,
  })
  if (r.ok && r.valor.fechamento) {
    await processarFidelidadeComandaFechada(admin, ator.restauranteId, conta.id)
    await auditar(admin, ator, 'conta.fechou', 'comanda', conta.id, {
      resumo: `total R$ ${Number(r.valor.fechamento.total).toFixed(2)} · com resolução de pendências`,
      de: 'aberta', para: 'fechada', motivo: a.motivo, numero: conta.numero, canal: conta.tipo, origem, mesa: conta.mesaNome,
    })
  }
  if (r.ok && r.valor.erro_fechamento) {
    return { ok: true as const, valor: { ...r.valor, erroFechamento: traduzirErro(r.valor.erro_fechamento).erro } }
  }
  return r
}

export async function reabrir(admin: SupabaseClient, ator: Ator, conta: ContaPresencial, motivo: string, origem: Origem) {
  return rpc<{ id: string }>(admin, 'comanda_reabrir', {
    p_restaurante: ator.restauranteId, p_comanda: conta.id, p_motivo: motivo, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
}

export async function cancelarPedido(admin: SupabaseClient, ator: Ator, pedidoId: string, motivo: string, qualquerEstado: boolean, origem: Origem) {
  return rpc<{ pedido: string; comanda: string }>(admin, 'pedido_presencial_cancelar', {
    p_restaurante: ator.restauranteId, p_pedido: pedidoId, p_motivo: motivo, p_ator: ator.userId, p_ator_nome: ator.nome,
    p_so_recebido_sem_pagamento: !qualquerEstado, p_origem: origem,
  })
}

export async function solicitarCancelamento(admin: SupabaseClient, ator: Ator, pedidoId: string, itemId: string | null, motivo: string) {
  return rpc<{ id: string; jaExistia: boolean }>(admin, 'cancelamento_solicitar', {
    p_restaurante: ator.restauranteId, p_pedido: pedidoId, p_item: itemId, p_motivo: motivo, p_ator: ator.userId, p_ator_nome: ator.nome,
  })
}

export async function decidirCancelamento(admin: SupabaseClient, ator: Ator, solicitacaoId: string, aprovar: boolean, observacao: string | null) {
  return rpc<{ id: string; aprovada: boolean }>(admin, 'cancelamento_decidir', {
    p_restaurante: ator.restauranteId, p_solicitacao: solicitacaoId, p_aprovar: aprovar, p_obs: observacao, p_ator: ator.userId, p_ator_nome: ator.nome,
  })
}

export async function cancelarItem(admin: SupabaseClient, ator: Ator, conta: ContaPresencial, itemId: string, motivo: string, origem: Origem) {
  const item = conta.pedidos.flatMap((p) => p.itens).find((i) => i.id === itemId)
  if (!item) return falha('Item não pertence a esta conta.', 404, 'item_inexistente')
  const r = await rpc<{ pedido: string; pedido_cancelado: boolean }>(admin, 'item_cancelar', {
    p_restaurante: ator.restauranteId, p_item: itemId, p_motivo: motivo, p_ator_nome: ator.nome,
  })
  if (r.ok) {
    await auditar(admin, ator, 'conta.cancelou_item', 'comanda', conta.id, {
      resumo: `${item.quantidade}× ${item.nome}`, motivo, item_id: itemId, de: 'ativo', para: 'cancelado',
      valor_afetado: Math.round(item.precoUnitario * item.quantidade * 100) / 100, origem,
    })
  }
  return r
}

export async function reimprimir(admin: SupabaseClient, ator: Ator, conta: ContaPresencial, pedidoId: string, origem: Origem): Promise<Resultado<null>> {
  const ped = conta.pedidos.find((p) => p.id === pedidoId)
  if (!ped) return falha('Pedido não pertence a esta conta.', 404, 'pedido_inexistente')
  if (ped.status === 'cancelado') return falha('Pedido cancelado não é reimpresso.', 409, 'ja_cancelado')
  const { error } = await admin
    .from('pedidos')
    .update({ reimprimir: true })
    .eq('id', pedidoId)
    .eq('restaurante_id', ator.restauranteId)
    .neq('status', 'cancelado')
  if (error) return falha('Erro ao pedir reimpressão.', 500, 'erro')
  await auditar(admin, ator, 'conta.reimprimiu', 'comanda', conta.id, { resumo: `#${ped.numero}`, origem })
  return { ok: true, valor: null }
}

// ─── fechamento completo (cozinha + pagamentos + fechamento numa transação) ──

/** Recalcula no banco o que a conta vale depois das decisões — e desfaz. */
export async function simularFechamento(admin: SupabaseClient, ator: Ator, comandaId: string, acoes: DecisaoFechamento[]) {
  return rpc<{ subtotal: number; taxa: number; desconto: number; total: number; pago: number; restante: number; cancelados: number; excedente: number; taxa_entrega: number }>(
    admin, 'comanda_fechamento_simular', { p_restaurante: ator.restauranteId, p_comanda: comandaId, p_acoes: acoes },
  )
}

/**
 * "Fechar conta": decisões da cozinha, pagamentos, cupom e fechamento — tudo ou nada,
 * idempotente pela chave. Fidelidade depois do commit (uma vez por conta, travada no banco).
 */
export async function fecharCompleto(
  admin: SupabaseClient,
  ator: Ator,
  conta: AlvoConta,
  a: { acoes: DecisaoFechamento[]; pagamentos: PagamentoFechamento[]; chave: string },
  formasAceitas: string[],
  origem: Origem,
) {
  for (const p of a.pagamentos) {
    if (!formasAceitas.includes(p.forma)) return falha('A loja não aceita esta forma de pagamento.')
    if (p.forma === 'fiado' && !p.observacao) return falha('No fiado, informe de quem é a conta (nome e contato).')
  }
  const r = await rpc<Record<string, unknown> & { idempotente: boolean }>(admin, 'comanda_fechar_completo', {
    p_restaurante: ator.restauranteId, p_comanda: conta.id, p_acoes: a.acoes, p_pagamentos: a.pagamentos,
    p_ator: ator.userId, p_ator_nome: ator.nome, p_papel: ator.papel, p_origem: origem, p_chave: a.chave,
  })
  if (!r.ok) {
    if (r.codigo === 'pendencias_abertas' || r.codigo === 'saldo_restante' || r.codigo === 'cancelamento_pendente') {
      const p = await pendencias(admin, ator, conta.id)
      return { ...r, pendencias: p.ok ? p.valor : null }
    }
    return r
  }
  if (!r.valor.idempotente) await processarFidelidadeComandaFechada(admin, ator.restauranteId, conta.id)
  return r
}

// ─── cupom na conta ─────────────────────────────────────────────────────────

/**
 * Cupom da conta presencial com as MESMAS regras do delivery (validarCupom + histórico
 * do telefone). O uso só é contado no fechamento (conta paga), uma vez por conta.
 */
export async function aplicarCupom(admin: SupabaseClient, ator: Ator, conta: ContaPresencial, codigoBruto: unknown, origem: Origem) {
  const codigo = typeof codigoBruto === 'string' ? normalizarCodigoCupom(codigoBruto) : ''
  if (!codigo) return falha('Informe o código do cupom.')
  if (conta.status !== 'aberta') return falha('Esta conta já foi fechada.', 409, 'comanda_nao_aberta')
  if (!conta.clienteTelefone) return falha('Para usar cupom, informe o telefone do cliente.', 400, 'cupom_exige_telefone')
  const { data: cupom, error } = await admin
    .from('cupons')
    .select('id, codigo, ativo, tipo, valor, publico, dias_inatividade, dias_semana, validade_inicio, validade_fim, valor_minimo_pedido, uso_unico_por_cliente, max_usos, usos')
    .eq('restaurante_id', ator.restauranteId)
    .eq('codigo', codigo)
    .eq('ativo', true)
    .maybeSingle()
  if (error) return falha('Erro ao conferir o cupom.', 500, 'erro')
  if (!cupom) return falha('Cupom não encontrado.', 404, 'cupom_invalido')
  const historico = await buscarHistoricoCliente(admin, ator.restauranteId, conta.clienteTelefone, cupom.id)
  const { hojeISO, diaSemana } = hojeSaoPaulo()
  const regra: CupomRegra = {
    ativo: cupom.ativo,
    tipo: cupom.tipo,
    valor: cupom.valor === null || cupom.valor === undefined ? null : Number(cupom.valor),
    publico: cupom.publico,
    diasInatividade: cupom.dias_inatividade,
    diasSemana: cupom.dias_semana ?? [],
    validadeInicio: cupom.validade_inicio,
    validadeFim: cupom.validade_fim,
    valorMinimoPedido: cupom.valor_minimo_pedido === null || cupom.valor_minimo_pedido === undefined ? null : Number(cupom.valor_minimo_pedido),
    usoUnicoPorCliente: cupom.uso_unico_por_cliente,
    maxUsos: cupom.max_usos,
    usos: cupom.usos,
  }
  const v = validarCupom(regra, historico, { subtotal: conta.totais.subtotal, diaSemana, hojeISO })
  if (!v.ok) return falha(v.motivo, 409, 'cupom_recusado')
  return rpc<{ id: string; cupom: string }>(admin, 'comanda_cupom_aplicar', {
    p_restaurante: ator.restauranteId, p_comanda: conta.id, p_cupom: cupom.id, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
}

export async function removerCupom(admin: SupabaseClient, ator: Ator, comandaId: string, origem: Origem) {
  return rpc<{ id: string; idempotente: boolean }>(admin, 'comanda_cupom_remover', {
    p_restaurante: ator.restauranteId, p_comanda: comandaId, p_ator: ator.userId, p_ator_nome: ator.nome, p_origem: origem,
  })
}
