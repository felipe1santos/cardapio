import type { SupabaseClient } from '@supabase/supabase-js'

export interface TamanhoPadraoPizza {
  id: string
  nome: string
  fatias: number
  posicao: number
}

export interface TamanhoPadraoMarmita {
  id: string
  nome: string
  peso: string
  posicao: number
}

export interface BordaPizza {
  id: string
  nome: string
  preco: number
  posicao: number
}

export interface MassaPizza {
  id: string
  nome: string
  preco: number
  posicao: number
}

// ─── Tamanhos padrão de pizza ──────────────────────────────────────────────

export async function listarTamanhosPadraoPizza(supabase: SupabaseClient, restauranteId: string): Promise<TamanhoPadraoPizza[]> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .select('id, nome, fatias, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function criarTamanhoPadraoPizza(supabase: SupabaseClient, restauranteId: string, nome: string, fatias: number, posicao: number): Promise<TamanhoPadraoPizza> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .insert({ restaurante_id: restauranteId, nome, fatias, posicao })
    .select('id, nome, fatias, posicao')
    .single()
  if (error) throw error
  return data
}

export async function atualizarTamanhoPadraoPizza(supabase: SupabaseClient, id: string, nome: string, fatias: number) {
  const { error } = await supabase.from('tamanhos_padrao_pizza').update({ nome, fatias }).eq('id', id)
  if (error) throw error
}

export async function removerTamanhoPadraoPizza(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('tamanhos_padrao_pizza').delete().eq('id', id)
  if (error) throw error
}

// ─── Tamanhos padrão de marmita ────────────────────────────────────────────

export async function listarTamanhosPadraoMarmita(supabase: SupabaseClient, restauranteId: string): Promise<TamanhoPadraoMarmita[]> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_marmita')
    .select('id, nome, peso, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function criarTamanhoPadraoMarmita(supabase: SupabaseClient, restauranteId: string, nome: string, peso: string, posicao: number): Promise<TamanhoPadraoMarmita> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_marmita')
    .insert({ restaurante_id: restauranteId, nome, peso, posicao })
    .select('id, nome, peso, posicao')
    .single()
  if (error) throw error
  return data
}

export async function atualizarTamanhoPadraoMarmita(supabase: SupabaseClient, id: string, nome: string, peso: string) {
  const { error } = await supabase.from('tamanhos_padrao_marmita').update({ nome, peso }).eq('id', id)
  if (error) throw error
}

export async function removerTamanhoPadraoMarmita(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('tamanhos_padrao_marmita').delete().eq('id', id)
  if (error) throw error
}

// ─── Bordas de pizza ────────────────────────────────────────────────────────

export async function listarBordasPizza(supabase: SupabaseClient, restauranteId: string): Promise<BordaPizza[]> {
  const { data, error } = await supabase
    .from('bordas_pizza')
    .select('id, nome, preco, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ ...d, preco: Number(d.preco) }))
}

export async function criarBordaPizza(supabase: SupabaseClient, restauranteId: string, nome: string, preco: number, posicao: number): Promise<BordaPizza> {
  const { data, error } = await supabase
    .from('bordas_pizza')
    .insert({ restaurante_id: restauranteId, nome, preco, posicao })
    .select('id, nome, preco, posicao')
    .single()
  if (error) throw error
  return { ...data, preco: Number(data.preco) }
}

export async function atualizarBordaPizza(supabase: SupabaseClient, id: string, nome: string, preco: number) {
  const { error } = await supabase.from('bordas_pizza').update({ nome, preco }).eq('id', id)
  if (error) throw error
}

export async function removerBordaPizza(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('bordas_pizza').delete().eq('id', id)
  if (error) throw error
}

// ─── Massas de pizza ────────────────────────────────────────────────────────

export async function listarMassasPizza(supabase: SupabaseClient, restauranteId: string): Promise<MassaPizza[]> {
  const { data, error } = await supabase
    .from('massas_pizza')
    .select('id, nome, preco, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ ...d, preco: Number(d.preco) }))
}

export async function criarMassaPizza(supabase: SupabaseClient, restauranteId: string, nome: string, preco: number, posicao: number): Promise<MassaPizza> {
  const { data, error } = await supabase
    .from('massas_pizza')
    .insert({ restaurante_id: restauranteId, nome, preco, posicao })
    .select('id, nome, preco, posicao')
    .single()
  if (error) throw error
  return { ...data, preco: Number(data.preco) }
}

export async function atualizarMassaPizza(supabase: SupabaseClient, id: string, nome: string, preco: number) {
  const { error } = await supabase.from('massas_pizza').update({ nome, preco }).eq('id', id)
  if (error) throw error
}

export async function removerMassaPizza(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('massas_pizza').delete().eq('id', id)
  if (error) throw error
}
