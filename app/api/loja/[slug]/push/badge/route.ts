import { NextResponse } from 'next/server'
import { getVitrineSupabase } from '@/lib/supabase/vitrine'
import { buscarRestaurantePorSlug } from '@/lib/queries/cardapio'
import { resolverPaleta } from '@/lib/paletas'
import { baixar, versaoPrevia } from '@/lib/previa-loja'
import { gerarBadgePng } from '@/lib/push/badge'

export const runtime = 'nodejs'

/** Badge da notificação push (silhueta branca da logo; sem silhueta boa, talher neutro). 96×96 PNG. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loja = await buscarRestaurantePorSlug(getVitrineSupabase(), slug).catch(() => null)
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  const logo = loja.logoUrl ? await baixar(loja.logoUrl) : null
  const { png, origem } = await gerarBadgePng(logo)
  const v = versaoPrevia({ nome: loja.nome, bannerUrl: null, logoUrl: loja.logoUrl ?? null, cor: resolverPaleta(loja.corTema).primaria })
  return new NextResponse(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      ETag: `"${v}-badge"`,
      'X-Badge-Origem': origem,
    },
  })
}
