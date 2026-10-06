import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Onde a loja fica, para os mapas abrirem nela (não mais no centro fixo de Fortaleza herdado do
 * protótipo): coordenadas de Ajustes e, sem elas, "Cidade, UF" para geocodificar.
 */
export interface LojaNoMapa {
  lat: number | null
  lng: number | null
  cidade: string | null
}

/** O que os mapas recebem: a loja, `null` (não se sabe) ou 'carregando' (espere antes de traçar). */
export type LojaDoMapa = LojaNoMapa | null | 'carregando'

/** Centro de reserva quando não se sabe nada da loja: o Brasil inteiro, nunca uma cidade qualquer. */
export const CENTRO_BRASIL = { lat: -14.24, lng: -51.93 }
export const ZOOM_BRASIL = 4
export const ZOOM_LOJA = 14
/** Meia-largura (graus) da caixa em volta da loja que puxa a geocodificação para a cidade dela. */
export const RAIO_VIES = 0.35

export function lojaNoMapaDe(row: { latitude?: unknown; longitude?: unknown; endereco_cidade?: unknown; endereco_estado?: unknown } | null | undefined): LojaNoMapa | null {
  if (!row) return null
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
  const cidade = [row.endereco_cidade, row.endereco_estado].filter((x) => typeof x === 'string' && x.trim()).join(', ') || null
  return { lat: num(row.latitude), lng: num(row.longitude), cidade }
}

export async function buscarLojaNoMapa(supabase: SupabaseClient, restauranteId: string): Promise<LojaNoMapa | null> {
  const { data } = await supabase.from('restaurantes').select('latitude, longitude, endereco_cidade, endereco_estado').eq('id', restauranteId).maybeSingle()
  return lojaNoMapaDe(data)
}
