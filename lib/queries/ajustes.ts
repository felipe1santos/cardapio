import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConfigLoja {
  id: string
  nome: string
  slug: string
  logoUrl: string | null
  telefone: string
  endereco: string
  taxaEntregaPadrao: number
  facebookPixelId: string | null
  googleTagId: string | null
}

interface ConfigRow {
  id: string
  nome: string
  slug: string
  logo_url: string | null
  telefone: string
  endereco: string
  taxa_entrega_padrao: number
  facebook_pixel_id: string | null
  google_tag_id: string | null
}

const CONFIG_SELECT = 'id, nome, slug, logo_url, telefone, endereco, taxa_entrega_padrao, facebook_pixel_id, google_tag_id'

function mapConfig(row: ConfigRow): ConfigLoja {
  return {
    id: row.id,
    nome: row.nome,
    slug: row.slug,
    logoUrl: row.logo_url,
    telefone: row.telefone,
    endereco: row.endereco,
    taxaEntregaPadrao: Number(row.taxa_entrega_padrao),
    facebookPixelId: row.facebook_pixel_id,
    googleTagId: row.google_tag_id,
  }
}

export async function buscarConfigLoja(supabase: SupabaseClient, restauranteId: string): Promise<ConfigLoja | null> {
  const { data, error } = await supabase.from('restaurantes').select(CONFIG_SELECT).eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return data ? mapConfig(data as ConfigRow) : null
}

export interface ConfigLojaPatch {
  nome?: string
  logoUrl?: string | null
  telefone?: string
  endereco?: string
  taxaEntregaPadrao?: number
  facebookPixelId?: string | null
  googleTagId?: string | null
}

export async function atualizarConfigLoja(supabase: SupabaseClient, restauranteId: string, patch: ConfigLojaPatch): Promise<ConfigLoja> {
  const row: Record<string, unknown> = {}
  if (patch.nome !== undefined) row.nome = patch.nome
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl
  if (patch.telefone !== undefined) row.telefone = patch.telefone
  if (patch.endereco !== undefined) row.endereco = patch.endereco
  if (patch.taxaEntregaPadrao !== undefined) row.taxa_entrega_padrao = patch.taxaEntregaPadrao
  if (patch.facebookPixelId !== undefined) row.facebook_pixel_id = patch.facebookPixelId
  if (patch.googleTagId !== undefined) row.google_tag_id = patch.googleTagId

  const { data, error } = await supabase.from('restaurantes').update(row).eq('id', restauranteId).select(CONFIG_SELECT).single()
  if (error) throw error
  return mapConfig(data as ConfigRow)
}

export interface TaxaBairro {
  id: string
  bairro: string
  taxa: number
}

export async function listarTaxasBairro(supabase: SupabaseClient, restauranteId: string): Promise<TaxaBairro[]> {
  const { data, error } = await supabase
    .from('taxas_entrega_bairro')
    .select('id, bairro, taxa')
    .eq('restaurante_id', restauranteId)
    .order('bairro', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ id: d.id, bairro: d.bairro, taxa: Number(d.taxa) }))
}

export async function criarTaxaBairro(supabase: SupabaseClient, restauranteId: string, bairro: string, taxa: number): Promise<TaxaBairro> {
  const { data, error } = await supabase
    .from('taxas_entrega_bairro')
    .insert({ restaurante_id: restauranteId, bairro, taxa })
    .select('id, bairro, taxa')
    .single()
  if (error) throw error
  return { id: data.id, bairro: data.bairro, taxa: Number(data.taxa) }
}

export async function atualizarTaxaBairro(supabase: SupabaseClient, id: string, bairro: string, taxa: number) {
  const { error } = await supabase.from('taxas_entrega_bairro').update({ bairro, taxa }).eq('id', id)
  if (error) throw error
}

export async function removerTaxaBairro(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('taxas_entrega_bairro').delete().eq('id', id)
  if (error) throw error
}
