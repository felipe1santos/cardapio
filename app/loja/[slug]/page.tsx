import { notFound } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { buscarRestaurantePorSlug } from '@/lib/queries/cardapio'
import Vitrine from './vitrine'

/**
 * Casca de servidor da vitrine.
 *
 * A página era 100% client-side: o navegador baixava 429 KB de JS, executava,
 * pedia `restaurantes` por slug, esperava mais sete queries e só então sabia a
 * URL da capa — que é o elemento de LCP. O Lighthouse mediu 4,1 s de "Load
 * Delay" nesse caminho, quase metade do LCP mobile.
 *
 * Aqui o restaurante é resolvido no servidor e entregue por prop. Duas coisas
 * mudam: o cabeçalho pinta na primeira renderização, e o `preload` abaixo põe a
 * capa na fila de download enquanto o HTML ainda está sendo lido — antes mesmo
 * de o JS existir.
 *
 * Usa a chave anon com as mesmas policies da vitrine pública; `service_role`
 * continua fora daqui.
 */

// A loja abre e fecha pelo relógio, então a página não pode ser estática. Um
// minuto de cache absorve rajadas sem deixar o status envelhecer na tela.
export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const supabase = await getServerSupabase()
    const loja = await buscarRestaurantePorSlug(supabase, slug)
    if (!loja) return { title: 'Loja não encontrada' }
    return {
      title: loja.nome,
      description: `Peça online no ${loja.nome}.`,
      openGraph: { title: loja.nome, images: loja.bannerUrl ? [loja.bannerUrl] : undefined },
    }
  } catch {
    return { title: 'Menuzia' }
  }
}

export default async function PaginaDaLoja({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await getServerSupabase()

  let loja
  try {
    loja = await buscarRestaurantePorSlug(supabase, slug)
  } catch {
    // Supabase fora do ar não pode virar 404: o cliente tenta de novo sozinho.
    loja = null
  }
  if (!loja) notFound()

  // O LCP da vitrine é a capa (ou a logo, quando a loja não tem capa).
  const lcp = loja.bannerUrl ?? loja.logoUrl

  return (
    <>
      {lcp && (
        // eslint-disable-next-line @next/next/no-head-element
        <link rel="preload" as="image" href={lcp} fetchPriority="high" />
      )}
      <Vitrine slug={slug} restauranteInicial={loja} />
    </>
  )
}
