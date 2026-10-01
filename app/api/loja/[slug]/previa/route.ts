import { NextResponse } from 'next/server'
import { getVitrineSupabase } from '@/lib/supabase/vitrine'
import { buscarRestaurantePorSlug } from '@/lib/queries/cardapio'
import { resolverPaleta } from '@/lib/paletas'
import { gerarPreviaJpeg, versaoPrevia } from '@/lib/previa-loja'

export const runtime = 'nodejs'

/**
 * og:image da vitrine: JPEG 1200×630 da loja (ver lib/previa-loja.ts). Público, sem login.
 * A URL leva ?v=<versão>; a versão muda quando muda a capa/logo/nome/cor, então a resposta
 * pode ficar em cache por muito tempo.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loja = await buscarRestaurantePorSlug(getVitrineSupabase(), slug).catch(() => null)
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  const dados = { nome: loja.nome, bannerUrl: loja.bannerUrl ?? null, logoUrl: loja.logoUrl ?? null, cor: resolverPaleta(loja.corTema).primaria }
  try {
    const jpeg = await gerarPreviaJpeg(dados)
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpeg.length),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        ETag: `"${versaoPrevia(dados)}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Não foi possível gerar a prévia' }, { status: 500 })
  }
}
