import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from '@/lib/custo/guarda'

/**
 * GEOCODIFICAÇÃO NO SERVIDOR (10/10/2026) — a única porta para a Geocoding API do Google.
 *   · cache compartilhado entre lojas (geocode_cache) pelo endereço NORMALIZADO, com sucesso E falha:
 *     "não encontrado" fica guardado 24 h; recusa do Google (faturamento, cota) 1 h — ninguém insiste;
 *   · toda chamada passa pela guarda de custo (limite diário, disparo, alertas);
 *   · chave SÓ de servidor: GOOGLE_MAPS_SERVER_KEY (Coolify, sem NEXT_PUBLIC). Sem ela, não geocodifica
 *     (o frete usa a reserva). A chave do navegador (NEXT_PUBLIC_…) nunca é usada aqui.
 */
export interface Coord { lat: number; lng: number }
export type ResultadoGeocode = { coord: Coord } | { coord: null; motivo: 'nao_encontrado' | 'indisponivel' }

export const FALHA_NAO_ENCONTRADO_MS = 24 * 3_600_000
export const FALHA_RECUSA_MS = 3_600_000

/** "Rua São João, 55 - Centro, Vila Velha/ES" → "rua sao joao 55 centro vila velha es". Pura. */
export function chaveEndereco(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 400)
}

/** Linha do cache ainda vale? Sucesso: sempre; falha: até expira_em. Pura. */
export function cacheValido(linha: { ok: boolean; expira_em: string | null } | null, agora = Date.now()): boolean {
  if (!linha) return false
  if (linha.ok) return true
  return !!linha.expira_em && Date.parse(linha.expira_em) > agora
}

export async function geocodificar(admin: SupabaseClient, consulta: string, loja: string | null): Promise<ResultadoGeocode> {
  const chave = chaveEndereco(consulta)
  if (chave.length < 4) return { coord: null, motivo: 'nao_encontrado' }
  const { data: linha } = await admin.from('geocode_cache').select('lat, lng, ok, expira_em').eq('chave', chave).maybeSingle()
  if (cacheValido(linha as { ok: boolean; expira_em: string | null } | null)) {
    const l = linha as { lat: number | null; lng: number | null; ok: boolean }
    return l.ok && l.lat !== null && l.lng !== null ? { coord: { lat: Number(l.lat), lng: Number(l.lng) } } : { coord: null, motivo: 'nao_encontrado' }
  }
  const chaveGoogle = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!chaveGoogle) return { coord: null, motivo: 'indisponivel' }

  const r = await chamarApiPaga(admin, { api: 'geocoding', chave, loja }, async () => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(consulta)}&region=br&key=${chaveGoogle}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return (await res.json()) as { status: string; error_message?: string; results?: { geometry?: { location?: Coord } }[] }
  })
  if (!r.ok) return { coord: null, motivo: 'indisponivel' }
  const loc = r.valor.results?.[0]?.geometry?.location
  const agora = Date.now()
  // Grava ANTES de devolver — sucesso e falha (a falha não é consultada de novo até expirar).
  if (r.valor.status === 'OK' && loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
    await admin.from('geocode_cache').upsert({ chave, lat: loc.lat, lng: loc.lng, ok: true, motivo: null, consultado_em: new Date(agora).toISOString(), expira_em: null }).then(() => {}, () => {})
    return { coord: { lat: loc.lat, lng: loc.lng } }
  }
  const naoAchou = r.valor.status === 'ZERO_RESULTS'
  await admin.from('geocode_cache').upsert({
    chave, lat: null, lng: null, ok: false, motivo: `${r.valor.status}${r.valor.error_message ? `: ${r.valor.error_message.slice(0, 120)}` : ''}`,
    consultado_em: new Date(agora).toISOString(), expira_em: new Date(agora + (naoAchou ? FALHA_NAO_ENCONTRADO_MS : FALHA_RECUSA_MS)).toISOString(),
  }).then(() => {}, () => {})
  return { coord: null, motivo: naoAchou ? 'nao_encontrado' : 'indisponivel' }
}
