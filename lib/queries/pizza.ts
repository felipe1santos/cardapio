import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClienteLeitura } from '@/lib/supabase/vitrine'
import type { RegraPrecoPizza } from '@/lib/pizza-preco'

export interface TamanhoPadraoPizza {
  id: string
  nome: string
  fatias: number
  posicao: number
  /** Quantos sabores cabem nesse tamanho. 1 = sem meio a meio. */
  maxSabores: number
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

// ─── Regra de preço da pizza multi-sabor ────────────────────────────────────

/** Como a loja calcula o preço da pizza com mais de um sabor. 'media' é o padrão. */
export async function buscarRegraPrecoPizza(supabase: ClienteLeitura, restauranteId: string): Promise<RegraPrecoPizza> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select('pizza_calculo_preco')
    .eq('id', restauranteId)
    .maybeSingle()
  if (error) throw error
  return data?.pizza_calculo_preco === 'maior' ? 'maior' : 'media'
}

// ─── Tamanhos padrão de pizza ──────────────────────────────────────────────

export async function listarTamanhosPadraoPizza(supabase: ClienteLeitura, restauranteId: string): Promise<TamanhoPadraoPizza[]> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .select('id, nome, fatias, posicao, max_sabores')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((t) => ({
    id: t.id,
    nome: t.nome,
    fatias: t.fatias,
    posicao: t.posicao,
    maxSabores: Math.max(1, Number(t.max_sabores ?? 1)),
  }))
}

export async function criarTamanhoPadraoPizza(
  supabase: SupabaseClient,
  restauranteId: string,
  nome: string,
  fatias: number,
  posicao: number,
  maxSabores = 1,
): Promise<TamanhoPadraoPizza> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .insert({ restaurante_id: restauranteId, nome, fatias, posicao, max_sabores: Math.max(1, maxSabores) })
    .select('id, nome, fatias, posicao, max_sabores')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, fatias: data.fatias, posicao: data.posicao, maxSabores: Math.max(1, Number(data.max_sabores ?? 1)) }
}

export async function atualizarTamanhoPadraoPizza(
  supabase: SupabaseClient,
  id: string,
  nome: string,
  fatias: number,
  maxSabores?: number,
) {
  const patch: { nome: string; fatias: number; max_sabores?: number } = { nome, fatias }
  if (maxSabores !== undefined) patch.max_sabores = Math.max(1, maxSabores)
  const { error } = await supabase.from('tamanhos_padrao_pizza').update(patch).eq('id', id)
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

export async function listarBordasPizza(supabase: ClienteLeitura, restauranteId: string): Promise<BordaPizza[]> {
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

export async function listarMassasPizza(supabase: ClienteLeitura, restauranteId: string): Promise<MassaPizza[]> {
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
