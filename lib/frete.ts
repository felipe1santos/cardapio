// Cálculo de frete por raio (linha reta) — utilitários de geocodificação e distância.
// Usado no servidor (endpoint /api/loja/[slug]/frete). Mantém o Google só como fallback;
// a primeira tentativa de coordenadas por CEP é a BrasilAPI, que é gratuita e sem chave.

export interface Coord {
  lat: number
  lng: number
}

/** Distância em km entre dois pontos pela fórmula de haversine (linha reta). */
export function haversineKm(a: Coord, b: Coord): number {
  const R = 6371 // raio da Terra em km
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

const soDigitos = (cep: string) => cep.replace(/\D/g, '')

/** Coordenadas de um CEP via BrasilAPI v2 (gratuita, sem chave). Null se não tiver. */
async function coordPorCepBrasilApi(cep: string): Promise<Coord | null> {
  const limpo = soDigitos(cep)
  if (limpo.length !== 8) return null
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${limpo}`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    const data = (await res.json()) as { location?: { coordinates?: { latitude?: string; longitude?: string } } }
    const c = data.location?.coordinates
    if (!c?.latitude || !c?.longitude) return null
    const lat = Number(c.latitude)
    const lng = Number(c.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    return null
  } catch {
    return null
  }
}

/** Geocodifica um texto livre (endereço ou CEP) via Google Geocoding REST. */
async function coordPorGoogle(consulta: string, mapsKey?: string): Promise<Coord | null> {
  if (!mapsKey || !consulta.trim()) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(consulta)}&region=br&key=${mapsKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = (await res.json()) as { status: string; results?: { geometry?: { location?: Coord } }[] }
    const loc = data.results?.[0]?.geometry?.location
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) return { lat: loc.lat, lng: loc.lng }
    return null
  } catch {
    return null
  }
}

/**
 * Resolve coordenadas de um endereço: tenta o endereço completo no Google (mais preciso),
 * depois o CEP na BrasilAPI (grátis) e, por fim, o CEP no Google.
 */
export async function geocodeEndereco(
  partes: { cep?: string; endereco?: string },
  mapsKey?: string
): Promise<Coord | null> {
  if (partes.endereco?.trim()) {
    const g = await coordPorGoogle(partes.endereco, mapsKey)
    if (g) return g
  }
  if (partes.cep) {
    const b = await coordPorCepBrasilApi(partes.cep)
    if (b) return b
    const g = await coordPorGoogle(soDigitos(partes.cep), mapsKey)
    if (g) return g
  }
  return null
}
