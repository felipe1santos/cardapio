import { NextResponse } from 'next/server'
import { getVitrineSupabase } from '@/lib/supabase/vitrine'
import { buscarRestaurantePorSlug } from '@/lib/queries/cardapio'
import { resolverPaleta } from '@/lib/paletas'
import { versaoPrevia } from '@/lib/previa-loja'

export const runtime = 'nodejs'

/**
 * Manifesto do app POR LOJA (2026-10-01): instalar a vitrine abre direto no cardápio da
 * loja, sem barra do navegador ("standalone"), com o nome, o ícone e a cor dela. Antes a
 * vitrine herdava o manifesto do painel (Menuzia, /admin).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loja = await buscarRestaurantePorSlug(getVitrineSupabase(), slug).catch(() => null)
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  const cor = resolverPaleta(loja.corTema).primaria
  const v = versaoPrevia({ nome: loja.nome, bannerUrl: null, logoUrl: loja.logoUrl ?? null, cor })
  const base = `/loja/${loja.slug}`
  const manifesto = {
    id: base,
    name: loja.nome,
    short_name: loja.nome.length > 12 ? loja.nome.slice(0, 12).trim() : loja.nome,
    description: `Peça online no ${loja.nome}.`,
    lang: 'pt-BR',
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F8FAFC',
    theme_color: cor,
    icons: [
      { src: `/api/loja/${loja.slug}/icone/192?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/api/loja/${loja.slug}/icone/512?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
  return new NextResponse(JSON.stringify(manifesto), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  })
}
