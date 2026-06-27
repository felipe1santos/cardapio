import type { SupabaseClient } from '@supabase/supabase-js'

export interface Mesa {
  id: string
  nome: string
  ordem: number
  ativa: boolean
}

interface MesaRow {
  id: string
  restaurante_id: string
  nome: string
  ordem: number
  ativa: boolean | null
  criado_em: string
}

export function mapMesaRow(row: MesaRow): Mesa {
  return { id: row.id, nome: row.nome, ordem: row.ordem, ativa: row.ativa ?? true }
}

export async function listarMesas(supabase: SupabaseClient, restauranteId: string): Promise<Mesa[]> {
  const { data, error } = await supabase
    .from('mesas')
    .select('id, restaurante_id, nome, ordem, ativa, criado_em')
    .eq('restaurante_id', restauranteId)
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as MesaRow[]).map(mapMesaRow)
}

export async function listarMesasAtivas(supabase: SupabaseClient, restauranteId: string): Promise<Mesa[]> {
  return (await listarMesas(supabase, restauranteId)).filter((m) => m.ativa)
}

export async function criarMesa(
  supabase: SupabaseClient,
  restauranteId: string,
  input: { nome: string; ordem: number },
): Promise<Mesa> {
  const { data, error } = await supabase
    .from('mesas')
    .insert({ restaurante_id: restauranteId, nome: input.nome, ordem: input.ordem })
    .select('id, restaurante_id, nome, ordem, ativa, criado_em')
    .single()
  if (error) throw error
  return mapMesaRow(data as MesaRow)
}

export async function atualizarMesa(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<{ nome: string; ordem: number; ativa: boolean }>,
): Promise<void> {
  const { error } = await supabase.from('mesas').update(patch).eq('id', id)
  if (error) throw error
}

export async function removerMesa(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('mesas').delete().eq('id', id)
  if (error) throw error
}
