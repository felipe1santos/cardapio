import { NextResponse } from 'next/server'
import { acessoDoMapa } from '@/lib/mapa/acesso'
import { chamarApiPaga } from '@/lib/custo/guarda'

/**
 * POST { origem: {lat,lng}, paradas: {lat,lng}[] (até 23), token? } → { polyline: string | null, motivo? }
 * Directions API pelo SERVIDOR (chave GOOGLE_MAPS_SERVER_KEY), com guarda de custo e cache de 10 min pela rota
 * arredondada (~11 m). Sem chave, limite ou erro: polyline null — a tela mostra "Rota indisponível no momento".
 */
const CACHE_MS = 10 * 60_000
const cache = new Map<string, { em: number; polyline: string | null }>()
type P = { lat: number; lng: number }
const valido = (p: unknown): p is P => !!p && typeof p === 'object' && Number.isFinite((p as P).lat) && Number.isFinite((p as P).lng) && Math.abs((p as P).lat) <= 90 && Math.abs((p as P).lng) <= 180
const fmt = (p: P) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
const indisponivel = { motivo: 'Rota indisponível no momento' }

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as { origem?: unknown; paradas?: unknown; token?: unknown } | null
  const a = await acessoDoMapa(request, corpo?.token)
  if ('erro' in a) return a.erro
  const paradas = (Array.isArray(corpo?.paradas) ? corpo.paradas : []).filter(valido).slice(0, 23)
  if (!valido(corpo?.origem) || !paradas.length) return NextResponse.json({ error: 'Rota inválida.' }, { status: 400 })
  const origem = corpo.origem as P
  const chave = [origem, ...paradas].map(fmt).join('|')
  const c = cache.get(chave)
  if (c && Date.now() - c.em < CACHE_MS) return NextResponse.json({ polyline: c.polyline, ...(c.polyline ? {} : indisponivel) })
  const chaveGoogle = process.env.GOOGLE_MAPS_SERVER_KEY
  let polyline: string | null = null
  if (chaveGoogle) {
    const destino = paradas[paradas.length - 1]
    const meio = paradas.slice(0, -1).map(fmt).join('|')
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${fmt(origem)}&destination=${fmt(destino)}${meio ? `&waypoints=${encodeURIComponent(meio)}` : ''}&mode=driving&region=br&key=${chaveGoogle}`
    const r = await chamarApiPaga(a.admin, { api: 'directions', chave, loja: a.loja }, async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
      return (await res.json()) as { status: string; routes?: { overview_polyline?: { points?: string } }[] }
    })
    if (r.ok && r.valor.status === 'OK') polyline = r.valor.routes?.[0]?.overview_polyline?.points ?? null
  }
  // A falha também fica guardada: ninguém insiste na mesma rota por 10 min.
  cache.set(chave, { em: Date.now(), polyline })
  if (cache.size > 2000) for (const [k, v] of cache) if (Date.now() - v.em >= CACHE_MS) cache.delete(k)
  return NextResponse.json({ polyline, ...(polyline ? {} : indisponivel) }, { headers: { 'Cache-Control': 'no-store' } })
}
