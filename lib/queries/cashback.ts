// Camada de dados do CASHBACK (Etapa 7, 20/10/2026, migration 0211). Tabelas só de servidor (service_role):
// cashback_regras (item → quanto dá → validade) e cashback_creditos (o que cada cliente tem).
// As regras de negócio (quanto dá, quanto usa, de qual crédito tira) são puras em lib/cashback-regras.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone } from './clientes'
import {
  calcularCreditosDoPedido, planejarConsumo, round2, saldoDisponivel, type CreditoDisponivel, type CreditoNovo, type RegraCashback,
} from '@/lib/cashback-regras'

export interface RegraCashbackInput {
  itemId: string
  tipo: 'valor' | 'percentual'
  valor: number
  validadeDias: number
  ativo: boolean
}

export interface RegraCashbackComItem extends RegraCashback {
  itemNome: string
  itemImagemUrl: string | null
  itemPreco: number
  /** Créditos gerados por esta regra que ainda estão disponíveis (quanto a loja "deve" hoje). */
  creditosAbertos: number
  valorAberto: number
}

export interface CashbackCliente {
  saldo: number
  proximaExpiracao: string | null
  creditos: { id: string; itemNome: string; saldo: number; expiraEm: string }[]
}

const SELECT_REGRA = 'id, item_id, tipo, valor, validade_dias, ativo, itens_cardapio ( nome, imagem_url, preco )'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRegra(r: any): RegraCashback {
  return { id: r.id, itemId: r.item_id, tipo: r.tipo, valor: Number(r.valor), validadeDias: Number(r.validade_dias), ativo: !!r.ativo }
}

export async function listarRegrasCashback(admin: SupabaseClient, restauranteId: string): Promise<RegraCashbackComItem[]> {
  const [{ data, error }, { data: abertos, error: erroAbertos }] = await Promise.all([
    admin.from('cashback_regras').select(SELECT_REGRA).eq('restaurante_id', restauranteId).order('criado_em', { ascending: true }),
    admin.from('cashback_creditos').select('regra_id, saldo').eq('restaurante_id', restauranteId).eq('status', 'disponivel').gt('expira_em', new Date().toISOString()),
  ])
  if (error) throw error
  if (erroAbertos) throw erroAbertos
  const porRegra = new Map<string, { n: number; v: number }>()
  for (const c of (abertos ?? []) as { regra_id: string | null; saldo: number }[]) {
    if (!c.regra_id) continue
    const a = porRegra.get(c.regra_id) ?? { n: 0, v: 0 }
    porRegra.set(c.regra_id, { n: a.n + 1, v: round2(a.v + Number(c.saldo)) })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...mapRegra(r),
    itemNome: r.itens_cardapio?.nome ?? 'Item',
    itemImagemUrl: r.itens_cardapio?.imagem_url ?? null,
    itemPreco: Number(r.itens_cardapio?.preco ?? 0),
    creditosAbertos: porRegra.get(r.id)?.n ?? 0,
    valorAberto: porRegra.get(r.id)?.v ?? 0,
  }))
}

function validarRegra(input: RegraCashbackInput): void {
  if (!input.itemId) throw new Error('Escolha o item do cardápio.')
  if (input.tipo !== 'valor' && input.tipo !== 'percentual') throw new Error('Tipo de cashback inválido.')
  if (!Number.isFinite(input.valor) || input.valor <= 0) throw new Error('Informe quanto de cashback o item dá.')
  if (input.tipo === 'percentual' && input.valor > 100) throw new Error('Cashback em % vai até 100.')
  if (!Number.isInteger(input.validadeDias) || input.validadeDias < 1 || input.validadeDias > 365) throw new Error('Validade: de 1 a 365 dias.')
}

/** Cria ou atualiza a regra do item (uma por item por loja). */
export async function salvarRegraCashback(admin: SupabaseClient, restauranteId: string, input: RegraCashbackInput): Promise<RegraCashback> {
  validarRegra(input)
  const { data: item, error: erroItem } = await admin.from('itens_cardapio').select('id').eq('id', input.itemId).eq('restaurante_id', restauranteId).maybeSingle()
  if (erroItem) throw erroItem
  if (!item) throw new Error('Item não encontrado nesta loja.')
  const { data, error } = await admin
    .from('cashback_regras')
    .upsert(
      { restaurante_id: restauranteId, item_id: input.itemId, tipo: input.tipo, valor: round2(input.valor), validade_dias: input.validadeDias, ativo: input.ativo, atualizado_em: new Date().toISOString() },
      { onConflict: 'restaurante_id,item_id' },
    )
    .select('id, item_id, tipo, valor, validade_dias, ativo')
    .single()
  if (error) throw error
  return mapRegra(data)
}

export async function excluirRegraCashback(admin: SupabaseClient, restauranteId: string, id: string): Promise<void> {
  const { error } = await admin.from('cashback_regras').delete().eq('id', id).eq('restaurante_id', restauranteId)
  if (error) throw error
}

async function regrasAtivas(admin: SupabaseClient, restauranteId: string): Promise<RegraCashback[]> {
  const { data, error } = await admin.from('cashback_regras').select('id, item_id, tipo, valor, validade_dias, ativo').eq('restaurante_id', restauranteId).eq('ativo', true)
  if (error) throw error
  return (data ?? []).map(mapRegra)
}

async function creditosDisponiveis(admin: SupabaseClient, restauranteId: string, telefone: string, agora: Date) {
  const { data, error } = await admin
    .from('cashback_creditos')
    .select('id, item_nome, saldo, expira_em')
    .eq('restaurante_id', restauranteId)
    .eq('cliente_telefone', telefone)
    .eq('status', 'disponivel')
    .gt('saldo', 0)
    .gt('expira_em', agora.toISOString())
    .order('expira_em', { ascending: true })
  if (error) throw error
  return (data ?? []).map((c: { id: string; item_nome: string; saldo: number; expira_em: string }) => ({ id: c.id, itemNome: c.item_nome, saldo: Number(c.saldo), expiraEm: c.expira_em }))
}

/** Saldo do cliente nesta loja (só o que ainda vale). */
export async function saldoCashbackCliente(admin: SupabaseClient, restauranteId: string, telefoneInformado: string, agora = new Date()): Promise<CashbackCliente> {
  const telefone = normalizarTelefone(telefoneInformado)
  if (!telefone) return { saldo: 0, proximaExpiracao: null, creditos: [] }
  const creditos = await creditosDisponiveis(admin, restauranteId, telefone, agora)
  const { saldo, proximaExpiracao } = saldoDisponivel(creditos, agora)
  return { saldo, proximaExpiracao, creditos }
}

/**
 * Credita o cashback de um pedido ENTREGUE. Idempotente: se o pedido já gerou crédito, não gera de novo.
 * Devolve os créditos criados (para a mensagem) e o saldo total depois deles.
 */
export async function creditarCashbackDoPedido(
  admin: SupabaseClient, restauranteId: string, pedidoId: string, telefoneInformado: string, entregueEm = new Date(),
): Promise<{ criados: CreditoNovo[]; saldoTotal: number }> {
  const telefone = normalizarTelefone(telefoneInformado)
  if (!telefone) return { criados: [], saldoTotal: 0 }
  const regras = await regrasAtivas(admin, restauranteId)
  if (regras.length === 0) return { criados: [], saldoTotal: 0 }
  const { data: ja, error: erroJa } = await admin.from('cashback_creditos').select('id').eq('pedido_origem_id', pedidoId).not('regra_id', 'is', null).limit(1)
  if (erroJa) throw erroJa
  if ((ja ?? []).length) return { criados: [], saldoTotal: 0 }
  const { data: itens, error: erroItens } = await admin.from('pedido_itens').select('item_id, nome, quantidade, preco_unitario, cancelado_em').eq('pedido_id', pedidoId)
  if (erroItens) throw erroItens
  const linhas = ((itens ?? []) as { item_id: string | null; nome: string; quantidade: number; preco_unitario: number; cancelado_em: string | null }[])
    .filter((i) => !i.cancelado_em)
    .map((i) => ({ itemId: i.item_id, nome: i.nome, quantidade: Number(i.quantidade), precoUnitario: Number(i.preco_unitario) }))
  const criados = calcularCreditosDoPedido(regras, linhas, entregueEm)
  if (criados.length === 0) return { criados: [], saldoTotal: 0 }
  const { error } = await admin.from('cashback_creditos').insert(criados.map((c) => ({
    restaurante_id: restauranteId, cliente_telefone: telefone, pedido_origem_id: pedidoId, regra_id: c.regraId, item_nome: c.itemNome,
    valor: c.valor, saldo: c.valor, expira_em: c.expiraEm, status: 'disponivel',
  })))
  if (error) throw error
  const { saldo } = await saldoCashbackCliente(admin, restauranteId, telefone, entregueEm)
  return { criados, saldoTotal: saldo }
}

export interface ConsumoCashback {
  /** Quanto de fato foi abatido (pode ser menor que o pedido se outro pedido consumiu antes). */
  valor: number
  usos: { id: string; usar: number; saldoAntes: number }[]
}

/**
 * Reserva `valor` do saldo do cliente ANTES de gravar o pedido (claim-first, como o cupom): baixa o saldo de cada
 * crédito com UPDATE condicional ao saldo lido — dois pedidos ao mesmo tempo não gastam o mesmo real.
 */
export async function consumirCashback(admin: SupabaseClient, restauranteId: string, telefoneInformado: string, valor: number, agora = new Date()): Promise<ConsumoCashback> {
  const telefone = normalizarTelefone(telefoneInformado)
  if (!telefone || valor <= 0) return { valor: 0, usos: [] }
  const creditos: CreditoDisponivel[] = await creditosDisponiveis(admin, restauranteId, telefone, agora)
  const plano = planejarConsumo(creditos, valor, agora)
  const feitos: ConsumoCashback['usos'] = []
  for (const u of plano.usos) {
    const novoSaldo = round2(u.saldoAntes - u.usar)
    const { data, error } = await admin
      .from('cashback_creditos')
      .update({ saldo: novoSaldo, ...(novoSaldo <= 0 ? { status: 'usado', usado_em: agora.toISOString() } : {}) })
      .eq('id', u.id)
      .eq('restaurante_id', restauranteId)
      .eq('status', 'disponivel')
      .eq('saldo', u.saldoAntes)
      .select('id')
    if (error) throw error
    if (!data?.length) break // outro pedido levou este crédito no meio: fica com o que já reservou
    feitos.push(u)
  }
  return { valor: round2(feitos.reduce((s, u) => s + u.usar, 0)), usos: feitos }
}

/** Desfaz uma reserva (o pedido não foi gravado). */
export async function devolverCashback(admin: SupabaseClient, restauranteId: string, usos: ConsumoCashback['usos']): Promise<void> {
  for (const u of usos) {
    const { error } = await admin.from('cashback_creditos').update({ saldo: u.saldoAntes, status: 'disponivel', usado_em: null, pedido_uso_id: null }).eq('id', u.id).eq('restaurante_id', restauranteId)
    if (error) console.error('[cashback] falha ao devolver crédito', u.id, error.message)
  }
}

/** Vínculo informativo: em qual pedido o crédito foi (totalmente) usado. */
export async function vincularCashbackAoPedido(admin: SupabaseClient, restauranteId: string, usos: ConsumoCashback['usos'], pedidoId: string): Promise<void> {
  const ids = usos.map((u) => u.id)
  if (ids.length === 0) return
  const { error } = await admin.from('cashback_creditos').update({ pedido_uso_id: pedidoId }).in('id', ids).eq('restaurante_id', restauranteId)
  if (error) console.error('[cashback] falha ao vincular créditos ao pedido', pedidoId, error.message)
}

/**
 * Pedido CANCELADO que tinha usado cashback: o valor volta como um crédito novo ("Devolução do pedido #N"),
 * válido por 30 dias. Idempotente (uma devolução por pedido). Créditos que o pedido gerou (se chegou a ser
 * entregue) ficam `revertido`. Lê o pedido aqui (status cancelado) para não acoplar o chamador à coluna da 0211.
 */
export async function reverterCashbackDoPedidoCancelado(admin: SupabaseClient, restauranteId: string, pedidoId: string, agora = new Date()): Promise<void> {
  const { data: pedido, error: erroPedido } = await admin.from('pedidos').select('id, numero, cliente_telefone, cashback_usado').eq('id', pedidoId).eq('restaurante_id', restauranteId).eq('status', 'cancelado').maybeSingle()
  if (erroPedido) throw erroPedido
  if (!pedido) return
  const { error: erroRev } = await admin.from('cashback_creditos').update({ status: 'revertido' }).eq('pedido_origem_id', pedido.id).eq('restaurante_id', restauranteId).not('regra_id', 'is', null).eq('status', 'disponivel')
  if (erroRev) throw erroRev
  const telefone = normalizarTelefone(pedido.cliente_telefone ?? '')
  const usado = round2(Number(pedido.cashback_usado ?? 0))
  if (!telefone || usado <= 0) return
  const { data: ja, error: erroJa } = await admin.from('cashback_creditos').select('id').eq('pedido_origem_id', pedido.id).is('regra_id', null).limit(1)
  if (erroJa) throw erroJa
  if ((ja ?? []).length) return
  const { error } = await admin.from('cashback_creditos').insert({
    restaurante_id: restauranteId, cliente_telefone: telefone, pedido_origem_id: pedido.id, regra_id: null, item_nome: `Devolução do pedido #${pedido.numero}`,
    valor: usado, saldo: usado, expira_em: new Date(agora.getTime() + 30 * 24 * 3600_000).toISOString(), status: 'disponivel',
  })
  if (error) throw error
}

/** Marca como expirado o que venceu (1 UPDATE, roda no cron da fila do WhatsApp). O saldo já ignora vencidos sem isto. */
export async function expirarCashbackVencidos(admin: SupabaseClient, agora = new Date()): Promise<number> {
  const { data, error } = await admin.from('cashback_creditos').update({ status: 'expirado' }).eq('status', 'disponivel').lt('expira_em', agora.toISOString()).select('id')
  if (error) throw error
  return (data ?? []).length
}
