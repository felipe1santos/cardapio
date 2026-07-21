// Cálculo de frete por raio (linha reta) — utilitários de geocodificação e distância.
// Usado no servidor (endpoint /api/loja/[slug]/frete). Mantém o Google só como fallback;
// a primeira tentativa de coordenadas por CEP é a BrasilAPI, que é gratuita e sem chave.

import type { SupabaseClient } from '@supabase/supabase-js'

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

/**
 * Normaliza nome de bairro para comparação: minúsculas, sem acentos e sem
 * espaços extras. "  São  José " → "sao jose". Usada no cliente (vitrine) e no
 * servidor para que "Sao Jose" digitado case com "São José" cadastrado.
 */
export function normalizarBairro(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

interface CepBrasilApi {
  coord: Coord | null
  /** Endereço textual do CEP ("Rua X, Bairro, Cidade, UF") para geocodificar no Google. */
  enderecoTexto: string | null
}

/**
 * Consulta um CEP na BrasilAPI v2 (gratuita, sem chave). Muitos CEPs vêm SEM
 * coordinates — nesses casos ainda aproveitamos rua/cidade/UF como texto para
 * o Google geocodificar a rua real (mais preciso que o centroide do CEP).
 */
async function cepPorBrasilApi(cep: string): Promise<CepBrasilApi> {
  const vazio: CepBrasilApi = { coord: null, enderecoTexto: null }
  const limpo = soDigitos(cep)
  if (limpo.length !== 8) return vazio
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${limpo}`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return vazio
    const data = (await res.json()) as {
      street?: string
      neighborhood?: string
      city?: string
      state?: string
      location?: { coordinates?: { latitude?: string; longitude?: string } }
    }
    let coord: Coord | null = null
    const c = data.location?.coordinates
    if (c?.latitude && c?.longitude) {
      const lat = Number(c.latitude)
      const lng = Number(c.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng)) coord = { lat, lng }
    }
    const partes = [data.street, data.neighborhood, data.city, data.state].map((s) => (s ?? '').trim()).filter(Boolean)
    return { coord, enderecoTexto: partes.length >= 2 ? partes.join(', ') : null }
  } catch {
    return vazio
  }
}

/** "29100500" → "29100-500" — o Google só resolve CEP nesse formato (e com país). */
function formatarCepGoogle(cep: string): string | null {
  const limpo = soDigitos(cep)
  if (limpo.length !== 8) return null
  return `${limpo.slice(0, 5)}-${limpo.slice(5)}, Brasil`
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
 * Resolve coordenadas de um endereço, do mais preciso ao mais genérico:
 * 1. endereço completo no Google;
 * 2. coordenadas oficiais do CEP na BrasilAPI (grátis);
 * 3. rua/cidade que a BrasilAPI devolve para o CEP, geocodificada no Google
 *    (muitos CEPs não têm coordinates na BrasilAPI);
 * 4. o próprio CEP no Google, no formato "29100-500, Brasil" (dígitos crus
 *    retornam ZERO_RESULTS).
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
    const b = await cepPorBrasilApi(partes.cep)
    if (b.coord) return b.coord
    if (b.enderecoTexto) {
      const g = await coordPorGoogle(b.enderecoTexto, mapsKey)
      if (g) return g
    }
    const cepGoogle = formatarCepGoogle(partes.cep)
    if (cepGoogle) {
      const g = await coordPorGoogle(cepGoogle, mapsKey)
      if (g) return g
    }
  }
  return null
}

// ── Decisão de entregabilidade ────────────────────────────────────────────────
// Regra (ver docs/superpowers/specs/2026-07-10-bairro-obrigatorio-lista-fechada-design.md):
// bairro cadastrado garante a entrega; se o endereço também cair numa faixa de raio
// MAIS BARATA, o cliente paga o menor dos dois valores. Sem match de bairro, valem
// as faixas de raio pela distância; a taxa padrão só vale quando a loja não
// restringiu área (sem bairros e sem raio).

export interface FreteDecisao {
  entregavel: boolean
  taxa: number
  fonte: 'bairro' | 'raio' | 'padrao'
  distanciaKm: number | null
  motivo?: string
}

export function decidirFrete(params: {
  bairroCliente: string
  bairros: { bairro: string; taxa: number }[]
  raios: { ateKm: number; taxa: number }[]
  taxaPadrao: number
  /** Distância loja→cliente em km; null quando o geocode falhou ou não foi tentado. */
  distanciaKm: number | null
}): FreteDecisao {
  const alvo = normalizarBairro(params.bairroCliente)
  const matchBairro = alvo ? params.bairros.find((b) => normalizarBairro(b.bairro) === alvo) : undefined
  if (matchBairro) {
    // Bairro cadastrado garante a entrega. Se a distância também cai numa faixa
    // de raio mais barata, cobra o MENOR valor; raio mais caro, fora do raio ou
    // geocode falho não atrapalham — a taxa do bairro segue valendo.
    if (params.raios.length > 0 && params.distanciaKm != null) {
      const faixa = params.raios.find((r) => params.distanciaKm! <= r.ateKm)
      if (faixa && faixa.taxa < matchBairro.taxa) {
        return { entregavel: true, taxa: faixa.taxa, fonte: 'raio', distanciaKm: Math.round(params.distanciaKm * 10) / 10 }
      }
    }
    return { entregavel: true, taxa: matchBairro.taxa, fonte: 'bairro', distanciaKm: null }
  }

  if (params.raios.length > 0) {
    if (params.distanciaKm != null) {
      const dist = Math.round(params.distanciaKm * 10) / 10
      const faixa = params.raios.find((r) => params.distanciaKm! <= r.ateKm)
      if (faixa) return { entregavel: true, taxa: faixa.taxa, fonte: 'raio', distanciaKm: dist }
      const maxKm = params.raios[params.raios.length - 1].ateKm
      return {
        entregavel: false,
        taxa: 0,
        fonte: 'raio',
        distanciaKm: dist,
        motivo: `Esse endereço está a ${dist} km — fora da área de entrega (até ${maxKm} km).`,
      }
    }
    return {
      entregavel: false,
      taxa: 0,
      fonte: 'raio',
      distanciaKm: null,
      motivo: 'Não conseguimos localizar esse endereço. Confira o CEP e os dados digitados.',
    }
  }

  if (params.bairros.length > 0) {
    return { entregavel: false, taxa: 0, fonte: 'bairro', distanciaKm: null, motivo: 'A loja não entrega nesse bairro.' }
  }

  return { entregavel: true, taxa: params.taxaPadrao, fonte: 'padrao', distanciaKm: null }
}

export interface EnderecoFrete {
  cep?: string
  rua?: string
  numero?: string
  bairro?: string
  cidade?: string
}

/**
 * Resolve o frete de um endereço buscando a configuração da loja no banco.
 * Geocodifica só quando necessário (bairro não resolveu e existem faixas de raio)
 * e cacheia as coordenadas da loja em restaurantes.latitude/longitude.
 * Usado pelo endpoint /api/loja/[slug]/frete e por criarPedido (server-authoritative).
 */
export async function resolverFrete(
  admin: SupabaseClient,
  restauranteId: string,
  endereco: EnderecoFrete,
  mapsKey?: string
): Promise<FreteDecisao> {
  const [{ data: loja }, { data: bairrosDb }, { data: raiosDb }] = await Promise.all([
    admin
      .from('restaurantes')
      .select('taxa_entrega_padrao, latitude, longitude, cep, endereco')
      .eq('id', restauranteId)
      .maybeSingle(),
    admin.from('taxas_entrega_bairro').select('bairro, taxa').eq('restaurante_id', restauranteId),
    admin.from('taxas_entrega_raio').select('ate_km, taxa').eq('restaurante_id', restauranteId).order('ate_km', { ascending: true }),
  ])
  const bairros = (bairrosDb ?? []).map((b) => ({ bairro: String(b.bairro), taxa: Number(b.taxa) }))
  const raios = (raiosDb ?? []).map((r) => ({ ateKm: Number(r.ate_km), taxa: Number(r.taxa) }))
  const taxaPadrao = loja ? Number(loja.taxa_entrega_padrao) || 0 : 0

  const alvo = normalizarBairro(endereco.bairro ?? '')
  const taxaBairro = alvo !== '' ? bairros.find((b) => normalizarBairro(b.bairro) === alvo)?.taxa : undefined
  const bairroResolve = taxaBairro !== undefined
  // Geocodifica quando o raio pode decidir: sem match de bairro, ou com match mas
  // existindo faixa de raio mais barata que ainda pode baratear a entrega.
  const raioPodeDecidir = raios.length > 0 && (!bairroResolve || raios.some((r) => r.taxa < taxaBairro!))

  let distanciaKm: number | null = null
  let lojaSemCoord = false
  if (raioPodeDecidir && loja) {
    let lojaCoord: Coord | null =
      loja.latitude != null && loja.longitude != null
        ? { lat: Number(loja.latitude), lng: Number(loja.longitude) }
        : null
    if (!lojaCoord) {
      lojaCoord = await geocodeEndereco({ cep: loja.cep ?? undefined, endereco: loja.endereco ?? undefined }, mapsKey)
      if (lojaCoord) {
        await admin.from('restaurantes').update({ latitude: lojaCoord.lat, longitude: lojaCoord.lng }).eq('id', restauranteId)
      }
    }
    if (lojaCoord) {
      const enderecoCliente = [endereco.rua, endereco.numero, endereco.bairro, endereco.cidade]
        .map((s) => (s ?? '').trim())
        .filter(Boolean)
        .join(', ')
      const clienteCoord = await geocodeEndereco({ cep: endereco.cep, endereco: enderecoCliente || undefined }, mapsKey)
      if (clienteCoord) distanciaKm = haversineKm(lojaCoord, clienteCoord)
    } else {
      // O problema é o cadastro da LOJA (CEP/endereço não geocodificam) — não
      // adianta geocodificar o cliente, e a mensagem não deve culpar o CEP dele.
      lojaSemCoord = true
    }
  }

  const decisao = decidirFrete({ bairroCliente: endereco.bairro ?? '', bairros, raios, taxaPadrao, distanciaKm })
  if (!decisao.entregavel && decisao.fonte === 'raio' && decisao.distanciaKm === null && lojaSemCoord) {
    decisao.motivo = 'O cálculo de entrega da loja está indisponível no momento. Fale com a loja para combinar a entrega.'
  }
  return decisao
}
