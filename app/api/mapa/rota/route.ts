import { NextResponse } from 'next/server'
import { acessoDoMapa } from '@/lib/mapa/acesso'
import { fmtPonto as fmt, rotaDoGoogle } from '@/lib/geocode/direcoes'

/**
 * POST { origem: {lat,lng}, paradas: {lat,lng}[] (até 23), token? } → { polyline: string | null, motivo? }
 * Directions API pelo SERVIDOR (chave GOOGLE_MAPS_SERVER_KEY), com guarda de custo e cache de 10 min pela rota
 * arredondada (~11 m). Sem chave, limite ou erro: polyline null — a tela mostra "Rota indisponível no momento".
 */
const CACHE_MS = 10 * 60_000
const cache = new Map<string, { em: number; polyline: string | null }>()
type P = { lat: number; lng: number }
const valido = (p: unknown): p is P => !!p && typeof p === 'object' && Number.isFinite((p as P).lat) && Number.isFinite((p as P).lng) && Math.abs((p as P).lat) <= 90 && Math.abs((p as P).lng) <= 180
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
  const polyline = await rotaDoGoogle(a.admin, origem, paradas, a.loja, chave)
  // A falha também fica guardada: ninguém insiste na mesma rota por 10 min.
  cache.set(chave, { em: Date.now(), polyline })
  if (cache.size > 2000) for (const [k, v] of cache) if (Date.now() - v.em >= CACHE_MS) cache.delete(k)
  return NextResponse.json({ polyline, ...(polyline ? {} : indisponivel) }, { headers: { 'Cache-Control': 'no-store' } })
}
