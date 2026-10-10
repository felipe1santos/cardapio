import { NextResponse } from 'next/server'
import { acessoDoMapa } from '@/lib/mapa/acesso'
import { geocodeEndereco } from '@/lib/frete'

/** POST { endereco, cep? } → { lat, lng } | { coord: null } — só sessão do painel (pin da loja em Ajustes). Cache + guarda. */
export async function POST(request: Request) {
  const a = await acessoDoMapa(request, null, { soPainel: true })
  if ('erro' in a) return a.erro
  const corpo = (await request.json().catch(() => null)) as { endereco?: unknown; cep?: unknown } | null
  const endereco = typeof corpo?.endereco === 'string' ? corpo.endereco.trim().slice(0, 300) : ''
  const cep = typeof corpo?.cep === 'string' ? corpo.cep.replace(/\D/g, '').slice(0, 8) : ''
  if (endereco.length < 4 && cep.length !== 8) return NextResponse.json({ error: 'Endereço inválido.' }, { status: 400 })
  const { coord } = await geocodeEndereco(a.admin, { endereco: endereco || undefined, cep: cep || undefined }, a.loja)
  return NextResponse.json(coord ? { lat: coord.lat, lng: coord.lng } : { coord: null }, { headers: { 'Cache-Control': 'no-store' } })
}
