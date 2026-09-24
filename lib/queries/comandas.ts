import type { SupabaseClient } from '@supabase/supabase-js'
import { PEDIDO_SELECT, mapPedido, type Pedido } from './pedidos'
import { listarMesasAtivas, type Mesa } from './mesas'

export type StatusComanda = 'aberta' | 'fechada' | 'transferida' | 'cancelada'

export interface Comanda {
  id: string
  mesaId: string
  status: StatusComanda
  abertaEm: string
  fechadaEm: string | null
  /** Número sequencial na loja (0072). Null em comanda anterior. */
  numero: number | null
  /** Nome do cliente do atendimento (0094). Null em comanda antiga. */
  clienteNome?: string | null
}

export interface MesaComEstado extends Mesa {
  comandaAberta: Comanda | null
  total: number
  qtdPedidos: number
}

interface ComandaRow {
  id: string
  restaurante_id: string
  mesa_id: string
  status: string
  aberta_em: string
  fechada_em: string | null
  numero?: number | null
  cliente_nome?: string | null
}

const COMANDA_SELECT = 'id, restaurante_id, mesa_id, status, aberta_em, fechada_em, numero, cliente_nome'

export function mapComandaRow(row: ComandaRow): Comanda {
  return {
    id: row.id,
    mesaId: row.mesa_id,
    // Nunca "arruma" um status desconhecido para 'aberta': comanda transferida (0067) ou
    // cancelada (0070) passando por aberta reabriria mesa que a operação já encerrou.
    status: (['aberta', 'fechada', 'transferida', 'cancelada'] as const).includes(row.status as StatusComanda)
      ? (row.status as StatusComanda)
      : 'fechada',
    abertaEm: row.aberta_em,
    fechadaEm: row.fechada_em ?? null,
    numero: row.numero ?? null,
    clienteNome: row.cliente_nome ?? null,
  }
}

/** Soma o total dos pedidos não-cancelados. Helper puro. */
export function calcularTotalComanda(pedidos: Pedido[]): number {
  return pedidos
    .filter((p) => p.status !== 'cancelado')
    .reduce((s, p) => s + p.total, 0)
}

export async function buscarComandaAberta(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<Comanda | null> {
  const { data, error } = await admin
    .from('comandas')
    .select(COMANDA_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .eq('status', 'aberta')
    .maybeSingle()
  if (error) throw error
  return data ? mapComandaRow(data as ComandaRow) : null
}

/**
 * Find-or-create da comanda aberta da mesa. O índice único parcial
 * `comandas_mesa_aberta_unq` garante no máximo 1 aberta por mesa; em corrida,
 * o insert viola o unique (código 23505) e a gente re-busca a existente.
 */
export async function abrirOuObterComanda(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId: string,
): Promise<{ comanda: Comanda; nasceuAgora: boolean }> {
  const { data: mesaRow, error: mesaErr } = await admin
    .from('mesas')
    .select('id')
    .eq('id', mesaId)
    .eq('restaurante_id', restauranteId)
    .maybeSingle()
  if (mesaErr) throw mesaErr
  if (!mesaRow) throw new Error('Mesa não encontrada nesta loja')

  const existente = await buscarComandaAberta(admin, restauranteId, mesaId)
  if (existente) return { comanda: existente, nasceuAgora: false }

  const { data, error } = await admin
    .from('comandas')
    .insert({ restaurante_id: restauranteId, mesa_id: mesaId })
    .select(COMANDA_SELECT)
    .single()

  if (error) {
    // Corrida: outra requisição criou a comanda entre o select e o insert.
    if (error.code === '23505') {
      const recuperada = await buscarComandaAberta(admin, restauranteId, mesaId)
      // Quem perdeu a corrida não "abriu" a mesa — quem auditar tem que saber disso.
      if (recuperada) return { comanda: recuperada, nasceuAgora: false }
    }
    throw error
  }
  return { comanda: mapComandaRow(data as ComandaRow), nasceuAgora: true }
}

export async function listarPedidosDaComanda(
  admin: SupabaseClient,
  restauranteId: string,
  comandaId: string,
): Promise<Pedido[]> {
  const { data, error } = await admin
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('comanda_id', comandaId)
    .order('criado_em', { ascending: true })
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row) => mapPedido(row as any))
}

/** Cancela um pedido da comanda (status 'cancelado'): some do Kanban/cozinha e sai do total. */
export async function cancelarPedidoComanda(
  admin: SupabaseClient,
  restauranteId: string,
  pedidoId: string,
): Promise<void> {
  const { error } = await admin
    .from('pedidos')
    .update({ status: 'cancelado' })
    .eq('id', pedidoId)
    .eq('restaurante_id', restauranteId)
    .not('comanda_id', 'is', null)
  if (error) throw error
}

/** Marca todos os pedidos não-cancelados da comanda como pagos (pago=true). */
export async function marcarComandaPaga(
  admin: SupabaseClient,
  restauranteId: string,
  comandaId: string,
): Promise<void> {
  const { error } = await admin
    .from('pedidos')
    .update({ pago: true })
    .eq('restaurante_id', restauranteId)
    .eq('comanda_id', comandaId)
    .neq('status', 'cancelado')
  if (error) throw error
}

/** Fecha a conta: marca a comanda como fechada. Só fecha se estiver aberta. */
export async function fecharComanda(
  admin: SupabaseClient,
  restauranteId: string,
  comandaId: string,
): Promise<void> {
  const { error } = await admin
    .from('comandas')
    .update({ status: 'fechada', fechada_em: new Date().toISOString() })
    .eq('id', comandaId)
    .eq('restaurante_id', restauranteId)
    .eq('status', 'aberta')
  if (error) throw error
}

/** Mesas ativas + estado de comanda aberta (total acumulado, qtd de pedidos não-cancelados). */
export async function listarMesasComEstado(
  admin: SupabaseClient,
  restauranteId: string,
): Promise<MesaComEstado[]> {
  const mesas = await listarMesasAtivas(admin, restauranteId)

  const { data: comandasData, error: comandasError } = await admin
    .from('comandas')
    .select(COMANDA_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('status', 'aberta')
  if (comandasError) throw comandasError
  const comandas = (comandasData ?? []).map((c) => mapComandaRow(c as ComandaRow))

  // UMA consulta para todos os pedidos das comandas abertas, e não uma por mesa: o
  // salão recarrega a cada evento de mesa, e com 13 mesas ocupadas isso eram 13 idas ao
  // banco por releitura. Aqui só o que a tela mostra (total e contagem) é lido.
  const idsComandas = comandas.map((c) => c.id)
  const porComanda = new Map<string, { total: number; qtdPedidos: number }>()
  if (idsComandas.length > 0) {
    const { data, error } = await admin
      .from('pedidos')
      .select('comanda_id, total, status')
      .eq('restaurante_id', restauranteId)
      .in('comanda_id', idsComandas)
    if (error) throw error
    for (const p of (data ?? []) as { comanda_id: string; total: number; status: string }[]) {
      if (p.status === 'cancelado') continue
      const atual = porComanda.get(p.comanda_id) ?? { total: 0, qtdPedidos: 0 }
      atual.total += Number(p.total)
      atual.qtdPedidos += 1
      porComanda.set(p.comanda_id, atual)
    }
  }

  return mesas.map((mesa) => {
    const comandaAberta = comandas.find((c) => c.mesaId === mesa.id) ?? null
    const resumo = comandaAberta ? porComanda.get(comandaAberta.id) : undefined
    return { ...mesa, comandaAberta, total: resumo?.total ?? 0, qtdPedidos: resumo?.qtdPedidos ?? 0 }
  })
}
