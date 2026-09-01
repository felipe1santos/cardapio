import { cache } from 'react'
import { notFound } from 'next/navigation'
import type { Viewport } from 'next'
import { getServerSupabase } from '@/lib/supabase/server'
import { buscarRestaurantePorSlug } from '@/lib/queries/cardapio'
import { TAMANHOS_CAPA, srcSetCapa } from '@/lib/imagem'
import { resolverPaleta } from '@/lib/paletas'
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

/**
 * Uma leitura da loja por requisição, compartilhada por `generateViewport`,
 * `generateMetadata` e o corpo da página. Sem o `cache` do React cada um desses
 * faria a sua própria query de `restaurantes`.
 *
 * Deixa o erro subir: cada chamador já decide o que fazer quando o Supabase não
 * responde, e um `null` aqui apagaria a diferença entre "loja não existe" e
 * "banco fora do ar".
 */
const carregarLoja = cache((slug: string) =>
  getServerSupabase().then((supabase) => buscarRestaurantePorSlug(supabase, slug))
)

/**
 * A barra do navegador (e a status bar do Android) usam a `theme-color`. O
 * layout raiz define o ciano da Menuzia, o que deixava a moldura do navegador
 * destoando do tema que o lojista escolheu em Ajustes → Aparência.
 *
 * Aqui ela passa a ser a mesma `--tema-primaria` que pinta os botões da vitrine.
 * Se a loja não existe ou o banco não responde, fica o ciano padrão do layout.
 */
export async function generateViewport({ params }: { params: Promise<{ slug: string }> }): Promise<Viewport> {
  const { slug } = await params
  try {
    const loja = await carregarLoja(slug)
    if (!loja) return {}
    return { themeColor: resolverPaleta(loja.corTema).primaria }
  } catch {
    return {}
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const loja = await carregarLoja(slug)
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

  let loja
  try {
    loja = await carregarLoja(slug)
  } catch {
    // Supabase fora do ar não pode virar 404: o cliente tenta de novo sozinho.
    loja = null
  }
  if (!loja) notFound()

  // O LCP da vitrine é a capa (ou a logo, quando a loja não tem capa).
  const lcp = loja.bannerUrl ?? loja.logoUrl
  // Quando existe a variante estreita, o preload precisa oferecer as mesmas
  // opções do <img>. Sem isso o navegador baixaria a de 1600 px no preload e a
  // de 800 px no elemento — duas imagens em vez de uma.
  const srcSet = srcSetCapa(loja.bannerUrl, loja.bannerMobileUrl)

  return (
    <>
      {lcp && (
        <link
          rel="preload"
          as="image"
          // Com `srcset`, o `href` NÃO pode ir junto: o navegador o trata como um
          // recurso à parte e baixa a versão de 1600 px além da que o srcset
          // escolheu — medido, duas requisições da mesma capa. Sem srcset ele é
          // a única forma de indicar o arquivo.
          {...(srcSet
            ? { imageSrcSet: srcSet, imageSizes: TAMANHOS_CAPA }
            : { href: lcp })}
          fetchPriority="high"
        />
      )}
      <Vitrine slug={slug} restauranteInicial={loja} />
    </>
  )
}
