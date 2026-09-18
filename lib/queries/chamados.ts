import type { SupabaseClient } from '@supabase/supabase-js'
import { mensagemDeErroConta } from '@/lib/conta'
import type { MotivoChamado, StatusChamado } from '@/lib/chamados'

/**
 * Chamados de garçom (0068).
 *
 * As três transições são funções do banco — a corrida entre dois garçons e o limite
 * anti-spam precisam ser decididos com a linha travada, não em TypeScript. Aqui só se
 * chama cada uma, traduz o erro e se lê o estado para as telas.
 */

export interface Chamado {
  id: string
  mesaId: string
  mesaNome: string
  motivo: MotivoChamado
  status: StatusChamado
  criadoEm: string
  assumidoPorNome: string | null
  assumidoEm: string | null
  concluidoPorNome: string | null
  concluidoEm: string | null
}

export type ResultadoChamado<T> = { ok: true; valor: T } | { ok: false; erro: string; codigo: string }

function codigoDo(message: string | undefined): string {
  return /([a-z][a-z_]*)(?::.*)?$/.exec((message ?? '').trim())?.[1] ?? ''
}

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<ResultadoChamado<T>> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) return { ok: false, erro: mensagemDeErroConta(error.message), codigo: codigoDo(error.message) }
  return { ok: true, valor: data as T }
}

export interface ChamadoAberto {
  id: string
  status: StatusChamado
  criado_em: string
  ja_existia: boolean
}

export const abrirChamado = (
  admin: SupabaseClient,
  a: { restauranteId: string; mesaId: string; sessaoId: string | null; motivo: MotivoChamado },
) =>
  rpc<ChamadoAberto>(admin, 'chamado_abrir', {
    p_restaurante: a.restauranteId,
    p_mesa: a.mesaId,
    p_sessao: a.sessaoId,
    p_motivo: a.motivo,
  })

export const assumirChamado = (
  admin: SupabaseClient,
  a: { restauranteId: string; chamadoId: string; atorId: string; atorNome: string },
) =>
  rpc<{ id: string; status: StatusChamado }>(admin, 'chamado_assumir', {
    p_restaurante: a.restauranteId, p_chamado: a.chamadoId, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

export const concluirChamado = (
  admin: SupabaseClient,
  a: { restauranteId: string; chamadoId: string; atorId: string; atorNome: string },
) =>
  rpc<{ id: string; status: StatusChamado }>(admin, 'chamado_concluir', {
    p_restaurante: a.restauranteId, p_chamado: a.chamadoId, p_ator: a.atorId, p_ator_nome: a.atorNome,
  })

const SELECT_CHAMADO = `
  id, mesa_id, motivo, status, criado_em, assumido_por_nome, assumido_em,
  concluido_por_nome, concluido_em, mesas ( nome )
`

interface ChamadoRow {
  id: string
  mesa_id: string
  motivo: MotivoChamado
  status: StatusChamado
  criado_em: string
  assumido_por_nome: string | null
  assumido_em: string | null
  concluido_por_nome: string | null
  concluido_em: string | null
  mesas: { nome: string } | { nome: string }[] | null
}

function mapChamado(row: ChamadoRow): Chamado {
  const mesa = Array.isArray(row.mesas) ? row.mesas[0] : row.mesas
  return {
    id: row.id,
    mesaId: row.mesa_id,
    mesaNome: mesa?.nome ?? 'Mesa',
    motivo: row.motivo,
    status: row.status,
    criadoEm: row.criado_em,
    assumidoPorNome: row.assumido_por_nome,
    assumidoEm: row.assumido_em,
    concluidoPorNome: row.concluido_por_nome,
    concluidoEm: row.concluido_em,
  }
}

/** Chamados que o salão precisa resolver agora. Serve o painel e o card da mesa. */
export async function listarChamadosAbertos(supabase: SupabaseClient, restauranteId: string): Promise<Chamado[]> {
  const { data, error } = await supabase
    .from('chamados_mesa')
    .select(SELECT_CHAMADO)
    .eq('restaurante_id', restauranteId)
    .in('status', ['pendente', 'assumido'])
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as ChamadoRow[]).map(mapChamado)
}

/** Histórico de chamados de uma mesa, para a aba de histórico da conta. */
export async function listarChamadosDaMesa(
  supabase: SupabaseClient,
  restauranteId: string,
  mesaId: string,
  limite = 20,
): Promise<Chamado[]> {
  const { data, error } = await supabase
    .from('chamados_mesa')
    .select(SELECT_CHAMADO)
    .eq('restaurante_id', restauranteId)
    .eq('mesa_id', mesaId)
    .order('criado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  return ((data ?? []) as unknown as ChamadoRow[]).map(mapChamado)
}
