import { NextResponse } from 'next/server'
import { getVitrineSupabase } from '@/lib/supabase/vitrine'
import { buscarRestaurantePorSlug } from '@/lib/queries/cardapio'
import { resolverPaleta } from '@/lib/paletas'
import { gerarIconePng, versaoPrevia } from '@/lib/previa-loja'

export const runtime = 'nodejs'

const TAMANHOS = new Set([180, 192, 512])

/** Ícone PNG da loja (app instalado / tela de início do iPhone). Tamanhos: 180, 192, 512. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; tamanho: string }> }) {
  const { slug, tamanho } = await params
  const lado = Number(tamanho.replace(/\.png$/, ''))
  if (!TAMANHOS.has(lado)) return NextResponse.json({ error: 'Tamanho inválido' }, { status: 404 })
  const loja = await buscarRestaurantePorSlug(getVitrineSupabase(), slug).catch(() => null)
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  const dados = { nome: loja.nome, bannerUrl: null, logoUrl: loja.logoUrl ?? null, cor: resolverPaleta(loja.corTema).primaria }
  try {
    const png = await gerarIconePng(dados, lado)
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        ETag: `"${versaoPrevia(dados)}-${lado}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Não foi possível gerar o ícone' }, { status: 500 })
  }
}
