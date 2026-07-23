import type { SupabaseClient } from '@supabase/supabase-js'
import type { LayoutCardapio } from './cardapio'
import type { HorarioFuncionamento, StatusLoja } from '@/lib/timezone'
import { composeEndereco } from '@/lib/endereco'

export interface ConfigLoja {
  id: string
  nome: string
  slug: string
  logoUrl: string | null
  bannerUrl: string | null
  bannerPromocionalUrl: string | null
  telefone: string
  endereco: string
  enderecoRua: string
  enderecoNumero: string
  enderecoComplemento: string
  enderecoBairro: string
  enderecoCidade: string
  enderecoEstado: string
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
  avaliacaoNota: number | null
  avaliacaoQtd: number | null
  horarioFuncionamento: HorarioFuncionamento | null
  statusLoja: StatusLoja
}

interface ConfigRow {
  id: string
  nome: string
  slug: string
  logo_url: string | null
  banner_url: string | null
  banner_promocional_url: string | null
  telefone: string
  endereco: string
  endereco_rua: string | null
  endereco_numero: string | null
  endereco_complemento: string | null
  endereco_bairro: string | null
  endereco_cidade: string | null
  endereco_estado: string | null
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
  avaliacao_nota: number | null
  avaliacao_qtd: number | null
  horario_funcionamento: HorarioFuncionamento | null
  status_loja: StatusLoja
}

const CONFIG_SELECT = 'id, nome, slug, logo_url, banner_url, banner_promocional_url, telefone, endereco, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, cep, taxa_entrega_padrao, frete_gratis_acima, facebook_pixel_id, google_tag_id, layout_cardapio, cor_tema, imagem_grande, latitude, longitude, avaliacao_nota, avaliacao_qtd, horario_funcionamento, status_loja'

function mapConfig(row: ConfigRow): ConfigLoja {
  return {
    id: row.id,
    nome: row.nome,
    slug: row.slug,
    logoUrl: row.logo_url,
    bannerUrl: row.banner_url,
    bannerPromocionalUrl: row.banner_promocional_url,
    telefone: row.telefone,
    endereco: row.endereco,
    enderecoRua: row.endereco_rua ?? '',
    enderecoNumero: row.endereco_numero ?? '',
    enderecoComplemento: row.endereco_complemento ?? '',
    enderecoBairro: row.endereco_bairro ?? '',
    enderecoCidade: row.endereco_cidade ?? '',
    enderecoEstado: row.endereco_estado ?? '',
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
    avaliacaoNota: row.avaliacao_nota === null || row.avaliacao_nota === undefined ? null : Number(row.avaliacao_nota),
    avaliacaoQtd: row.avaliacao_qtd ?? null,
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
  bannerPromocionalUrl?: string | null
  telefone?: string
  endereco?: string
  enderecoRua?: string
  enderecoNumero?: string
  enderecoComplemento?: string
  enderecoBairro?: string
  enderecoCidade?: string
  enderecoEstado?: string
  cep?: string
  latitude?: number | null
  longitude?: number | null
  avaliacaoNota?: number | null
  avaliacaoQtd?: number | null
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
  if (patch.bannerPromocionalUrl !== undefined) row.banner_promocional_url = patch.bannerPromocionalUrl
  if (patch.telefone !== undefined) row.telefone = patch.telefone

  // Campos estruturados vêm sempre juntos (o form da aba Loja manda os 6 de uma vez) —
  // quando presentes, recompõe o endereco texto-livre automaticamente. `patch.endereco`
  // direto continua aceito pra qualquer chamada legada que não use os campos separados.
  let enderecoMudou = false
  if (patch.enderecoRua !== undefined) {
    row.endereco_rua = patch.enderecoRua
    row.endereco_numero = patch.enderecoNumero ?? ''
    row.endereco_complemento = patch.enderecoComplemento ?? ''
    row.endereco_bairro = patch.enderecoBairro ?? ''
    row.endereco_cidade = patch.enderecoCidade ?? ''
    row.endereco_estado = patch.enderecoEstado ?? ''
    const composto = composeEndereco({
      rua: patch.enderecoRua,
      numero: patch.enderecoNumero ?? '',
      complemento: patch.enderecoComplemento ?? '',
      bairro: patch.enderecoBairro ?? '',
      cidade: patch.enderecoCidade ?? '',
      estado: patch.enderecoEstado ?? '',
    })
    // Loja legada sem os campos estruturados ainda preenchidos: preserva o
    // endereco de texto livre existente em vez de apagar com string vazia.
    if (composto !== '') {
      row.endereco = composto
      enderecoMudou = true
    }
  } else if (patch.endereco !== undefined) {
    row.endereco = patch.endereco
    enderecoMudou = true
  }
  if (patch.cep !== undefined) {
    row.cep = patch.cep
    enderecoMudou = true
  }

  // Se quem chamou já manda lat/lng junto (aba Loja, com o PIN confirmado no mapa),
  // grava direto. Senão, se endereço/CEP mudaram sem coordenada nova junto (chamada
  // legada), invalida o cache pro próximo cálculo de frete regeocodificar.
  if (patch.latitude !== undefined && patch.longitude !== undefined) {
    row.latitude = patch.latitude
    row.longitude = patch.longitude
  } else if (enderecoMudou) {
    row.latitude = null
    row.longitude = null
  }

  if (patch.avaliacaoNota !== undefined) row.avaliacao_nota = patch.avaliacaoNota
  if (patch.avaliacaoQtd !== undefined) row.avaliacao_qtd = patch.avaliacaoQtd
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

export function enviarBannerPromocionalLoja(supabase: SupabaseClient, restauranteId: string, file: File): Promise<string> {
  return enviarImagemPerfil(supabase, restauranteId, file, 'banner-promo')
}
