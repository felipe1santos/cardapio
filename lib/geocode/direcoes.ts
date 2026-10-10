import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from '@/lib/custo/guarda'

/**
 * Directions API do Google pelo SERVIDOR (GOOGLE_MAPS_SERVER_KEY), sempre pela guarda de custo (docs/REGRAS-DE-CUSTO.md).
 * Devolve a polyline da rota ou null (sem chave, limite da guarda, erro ou sem rota). Quem chama guarda o cache.
 */
export type Ponto = { lat: number; lng: number }
export const fmtPonto = (p: Ponto) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`

export async function rotaDoGoogle(admin: SupabaseClient, origem: Ponto, paradas: Ponto[], loja: string | null, chave: string): Promise<string | null> {
  const chaveGoogle = process.env.GOOGLE_MAPS_SERVER_KEY
  if (!chaveGoogle || !paradas.length) return null
  const destino = paradas[paradas.length - 1]
  const meio = paradas.slice(0, -1).map(fmtPonto).join('|')
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fmtPonto(origem)}&destination=${fmtPonto(destino)}${meio ? `&waypoints=${encodeURIComponent(meio)}` : ''}&mode=driving&region=br&key=${chaveGoogle}`
  const r = await chamarApiPaga(admin, { api: 'directions', chave, loja }, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    return (await res.json()) as { status: string; routes?: { overview_polyline?: { points?: string } }[] }
  })
  return r.ok && r.valor.status === 'OK' ? r.valor.routes?.[0]?.overview_polyline?.points ?? null : null
}
