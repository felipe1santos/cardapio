import type { SupabaseClient } from '@supabase/supabase-js'
import { PEDIDO_SELECT, mapPedido, type Pedido } from './pedidos'
import { listarMesasAtivas, type Mesa } from './mesas'

export interface Comanda {
  id: string
  mesaId: string
  status: 'aberta' | 'fechada'
  abertaEm: string
  fechadaEm: string | null
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
}

const COMANDA_SELECT = 'id, restaurante_id, mesa_id, status, aberta_em, fechada_em'

export function mapComandaRow(row: ComandaRow): Comanda {
  return {
    id: row.id,
    mesaId: row.mesa_id,
    status: row.status === 'fechada' ? 'fechada' : 'aberta',
    abertaEm: row.aberta_em,
    fechadaEm: row.fechada_em ?? null,
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
): Promise<Comanda> {
  const existente = await buscarComandaAberta(admin, restauranteId, mesaId)
  if (existente) return existente

  const { data, error } = await admin
    .from('comandas')
    .insert({ restaurante_id: restauranteId, mesa_id: mesaId })
    .select(COMANDA_SELECT)
    .single()

  if (error) {
    // Corrida: outra requisição criou a comanda entre o select e o insert.
    if (error.code === '23505') {
      const recuperada = await buscarComandaAberta(admin, restauranteId, mesaId)
      if (recuperada) return recuperada
    }
    throw error
  }
  return mapComandaRow(data as ComandaRow)
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

  const estados: MesaComEstado[] = []
  for (const mesa of mesas) {
    const comandaAberta = comandas.find((c) => c.mesaId === mesa.id) ?? null
    let total = 0
    let qtdPedidos = 0
    if (comandaAberta) {
      const pedidos = await listarPedidosDaComanda(admin, restauranteId, comandaAberta.id)
      const ativos = pedidos.filter((p) => p.status !== 'cancelado')
      total = calcularTotalComanda(pedidos)
      qtdPedidos = ativos.length
    }
    estados.push({ ...mesa, comandaAberta, total, qtdPedidos })
  }
  return estados
}
