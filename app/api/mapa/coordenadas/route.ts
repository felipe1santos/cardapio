import { NextResponse } from 'next/server'
import { acessoDoMapa } from '@/lib/mapa/acesso'
import { coordenadasDosPedidos } from '@/lib/mapa/coordenadas-pedidos'

/**
 * POST { pedidoIds: string[] (até 100), token? } → { coords: { [id]: { lat, lng } | null } }
 * Coordenadas gravadas no pedido; sem elas, uma geocodificação no servidor (cache + guarda) gravada no pedido.
 */
export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as { pedidoIds?: unknown; token?: unknown } | null
  const a = await acessoDoMapa(request, corpo?.token)
  if ('erro' in a) return a.erro
  const lista = Array.isArray(corpo?.pedidoIds) ? corpo.pedidoIds : []
  const ids = [...new Set(lista.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 100)
  return NextResponse.json({ coords: await coordenadasDosPedidos(a.admin, a.loja, ids) }, { headers: { 'Cache-Control': 'no-store' } })
}
