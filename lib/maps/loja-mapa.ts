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

/** Pino da LOJA (20/10, estilo Google Meu Negócio): gota azul-escura com a fachada da loja em branco. */
export function lojaIcon(): google.maps.Icon {
  const svg = `
    <svg width="44" height="52" viewBox="0 0 44 52" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 1C10.4 1 1 9.6 1 20.2 1 34.4 22 51 22 51s21-16.6 21-30.8C43 9.6 33.6 1 22 1z" fill="#1A73E8" stroke="#ffffff" stroke-width="2"/>
      <g transform="translate(11 9)" fill="#ffffff">
        <path d="M2 2h18l2 6.2c0 1.8-1.4 3.2-3.2 3.2-1.5 0-2.7-1-3.1-2.3-.4 1.3-1.6 2.3-3.1 2.3s-2.7-1-3.1-2.3c-.4 1.3-1.6 2.3-3.1 2.3S1.8 10.4 1.4 9.1L0 8.2 2 2z"/>
        <path d="M2.5 13.2h17V22h-6.3v-5.4H8.8V22H2.5z"/>
      </g>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(44, 52),
    anchor: new google.maps.Point(22, 51),
  }
}
