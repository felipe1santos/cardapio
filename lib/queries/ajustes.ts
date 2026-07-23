import type { SupabaseClient } from '@supabase/supabase-js'
import type { LayoutCardapio } from './cardapio'
import type { HorarioFuncionamento, StatusLoja } from '@/lib/timezone'

export interface ConfigLoja {
  id: string
  nome: string
  slug: string
  logoUrl: string | null
  bannerUrl: string | null
  telefone: string
  endereco: string
  cep: string
  taxaEntregaPadrao: number
  /** Pedidos com subtotal >= este valor têm entrega grátis. Null = desativado. */
  freteGratisAcima: number | null
  facebookPixelId: string | null
  googleTagId: string | null
  layoutCardapio: LayoutCardapio
  corTema: string
  imagemGrande: boolean
  latitude: number | null
  longitude: number | null
  horarioFuncionamento: HorarioFuncionamento | null
  statusLoja: StatusLoja
}

interface ConfigRow {
  id: string
  nome: string
  slug: string
  logo_url: string | null
  banner_url: string | null
  telefone: string
  endereco: string
  cep: string | null
  taxa_entrega_padrao: number
  frete_gratis_acima: number | null
  facebook_pixel_id: string | null
  google_tag_id: string | null
  layout_cardapio: LayoutCardapio
  cor_tema: string
  imagem_grande: boolean
  latitude: number | null
  longitude: number | null
  horario_funcionamento: HorarioFuncionamento | null
  status_loja: StatusLoja
}

const CONFIG_SELECT = 'id, nome, slug, logo_url, banner_url, telefone, endereco, cep, taxa_entrega_padrao, frete_gratis_acima, facebook_pixel_id, google_tag_id, layout_cardapio, cor_tema, imagem_grande, latitude, longitude, horario_funcionamento, status_loja'

function mapConfig(row: ConfigRow): ConfigLoja {
  return {
    id: row.id,
    nome: row.nome,
    slug: row.slug,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    telefone: row.telefone,
    endereco: row.endereco,
    cep: row.cep ?? '',
    taxaEntregaPadrao: Number(row.taxa_entrega_padrao),
    freteGratisAcima: row.frete_gratis_acima === null ? null : Number(row.frete_gratis_acima),
    facebookPixelId: row.facebook_pixel_id,
    googleTagId: row.google_tag_id,
    layoutCardapio: row.layout_cardapio ?? 'categoria',
    corTema: row.cor_tema ?? 'azul',
    imagemGrande: row.imagem_grande ?? false,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    horarioFuncionamento: row.horario_funcionamento ?? null,
    statusLoja: row.status_loja ?? 'automatico',
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
  bannerUrl?: string | null
  telefone?: string
  endereco?: string
  cep?: string
  taxaEntregaPadrao?: number
  freteGratisAcima?: number | null
  facebookPixelId?: string | null
  googleTagId?: string | null
  layoutCardapio?: LayoutCardapio
  corTema?: string
  imagemGrande?: boolean
  horarioFuncionamento?: HorarioFuncionamento
}

export async function atualizarConfigLoja(supabase: SupabaseClient, restauranteId: string, patch: ConfigLojaPatch): Promise<ConfigLoja> {
  const row: Record<string, unknown> = {}
  if (patch.nome !== undefined) row.nome = patch.nome
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl
  if (patch.bannerUrl !== undefined) row.banner_url = patch.bannerUrl
  if (patch.telefone !== undefined) row.telefone = patch.telefone
  if (patch.endereco !== undefined) row.endereco = patch.endereco
  if (patch.cep !== undefined) row.cep = patch.cep
  // Endereço/CEP mudou → as coordenadas cacheadas ficam obsoletas. Zera para o
  // próximo cálculo de frete (ou a aba Entrega) geocodificar de novo.
  if (patch.endereco !== undefined || patch.cep !== undefined) {
    row.latitude = null
    row.longitude = null
  }
  if (patch.taxaEntregaPadrao !== undefined) row.taxa_entrega_padrao = patch.taxaEntregaPadrao
  if (patch.freteGratisAcima !== undefined) row.frete_gratis_acima = patch.freteGratisAcima
  if (patch.facebookPixelId !== undefined) row.facebook_pixel_id = patch.facebookPixelId
  if (patch.googleTagId !== undefined) row.google_tag_id = patch.googleTagId
  if (patch.layoutCardapio !== undefined) row.layout_cardapio = patch.layoutCardapio
  if (patch.corTema !== undefined) row.cor_tema = patch.corTema
  if (patch.imagemGrande !== undefined) row.imagem_grande = patch.imagemGrande
  if (patch.horarioFuncionamento !== undefined) row.horario_funcionamento = patch.horarioFuncionamento

  const { data, error } = await supabase.from('restaurantes').update(row).eq('id', restauranteId).select(CONFIG_SELECT).single()
  if (error) throw error
  return mapConfig(data as ConfigRow)
}

/** Toggle rápido usado no Kanban: força a loja aberta/fechada, ou devolve pro modo automático (segue a grade de horário). */
export async function definirStatusLoja(supabase: SupabaseClient, restauranteId: string, status: StatusLoja): Promise<void> {
  const { error } = await supabase.from('restaurantes').update({ status_loja: status }).eq('id', restauranteId)
  if (error) throw error
}

/** Leitura leve (sem o resto do ConfigLoja) usada pra calcular "aberto agora" — Kanban, vitrine, criarPedido. */
export async function buscarStatusELoja(
  supabase: SupabaseClient,
  restauranteId: string
): Promise<{ statusLoja: StatusLoja; horarioFuncionamento: HorarioFuncionamento | null } | null> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select('status_loja, horario_funcionamento')
    .eq('id', restauranteId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { statusLoja: data.status_loja ?? 'automatico', horarioFuncionamento: data.horario_funcionamento ?? null }
}

/** Salva as coordenadas geocodificadas da loja (usadas pelo frete por raio). */
export async function salvarCoordenadasLoja(supabase: SupabaseClient, restauranteId: string, lat: number, lng: number) {
  const { error } = await supabase.from('restaurantes').update({ latitude: lat, longitude: lng }).eq('id', restauranteId)
  if (error) throw error
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

// ─── Entrega por raio (faixas de km) ─────────────────────────────────────────

export interface TaxaRaio {
  id: string
  ateKm: number
  taxa: number
}

export async function listarTaxasRaio(supabase: SupabaseClient, restauranteId: string): Promise<TaxaRaio[]> {
  const { data, error } = await supabase
    .from('taxas_entrega_raio')
    .select('id, ate_km, taxa')
    .eq('restaurante_id', restauranteId)
    .order('ate_km', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ id: d.id, ateKm: Number(d.ate_km), taxa: Number(d.taxa) }))
}

export async function criarTaxaRaio(supabase: SupabaseClient, restauranteId: string, ateKm: number, taxa: number): Promise<TaxaRaio> {
  const { data, error } = await supabase
    .from('taxas_entrega_raio')
    .insert({ restaurante_id: restauranteId, ate_km: ateKm, taxa })
    .select('id, ate_km, taxa')
    .single()
  if (error) throw error
  return { id: data.id, ateKm: Number(data.ate_km), taxa: Number(data.taxa) }
}

export async function atualizarTaxaRaio(supabase: SupabaseClient, id: string, ateKm: number, taxa: number) {
  const { error } = await supabase.from('taxas_entrega_raio').update({ ate_km: ateKm, taxa }).eq('id', id)
  if (error) throw error
}

export async function removerTaxaRaio(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('taxas_entrega_raio').delete().eq('id', id)
  if (error) throw error
}

/** Uploads a profile image (logo/banner) to the tenant-scoped folder of the public `cardapio` bucket and returns its public URL. */
async function enviarImagemPerfil(supabase: SupabaseClient, restauranteId: string, file: File, prefixo: string): Promise<string> {
  const extensao = file.name.split('.').pop() ?? 'jpg'
  const caminho = `${restauranteId}/perfil/${prefixo}-${crypto.randomUUID()}.${extensao}`

  const { error } = await supabase.storage.from('cardapio').upload(caminho, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error

  const { data } = supabase.storage.from('cardapio').getPublicUrl(caminho)
  return data.publicUrl
}

export function enviarLogoLoja(supabase: SupabaseClient, restauranteId: string, file: File): Promise<string> {
  return enviarImagemPerfil(supabase, restauranteId, file, 'logo')
}

export function enviarBannerLoja(supabase: SupabaseClient, restauranteId: string, file: File): Promise<string> {
  return enviarImagemPerfil(supabase, restauranteId, file, 'banner')
}
