import { cache } from 'react'
import { notFound } from 'next/navigation'
import type { Viewport } from 'next'
import { getVitrineSupabase } from '@/lib/supabase/vitrine'
import { urlPublica } from '@/lib/url-publica'
import { PREVIA_ALTURA, PREVIA_LARGURA, versaoPrevia } from '@/lib/previa-loja'
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
// Leitura ANÔNIMA, sem a sessão do visitante: desde a 0080 um usuário logado só
// enxerga a própria loja em `restaurantes`. Com a sessão, um lojista logado que
// abrisse a vitrine de outra loja veria "loja não encontrada". A vitrine é pública
// e só usa colunas liberadas ao anônimo (0055) — o mesmo client do navegador.
const carregarLoja = cache((slug: string) => buscarRestaurantePorSlug(getVitrineSupabase(), slug))

/**
 * A barra do navegador (e a status bar do Android) usam a `theme-color`. O
 * layout raiz define o ciano da Menuzia, o que deixava a moldura do navegador
 * destoando do tema que o lojista escolheu em Ajustes → Aparência.
 *
 * Aqui ela passa a ser a mesma `--tema-primaria` que pinta os botões da vitrine.
 * Se a loja não existe ou o banco não responde, fica o ciano padrão do layout.
 */
/**
 * Sem zoom na vitrine: a pinça quebrava o layout de app no celular. Só aqui — o
 * painel, o PDV e as mesas seguem com o viewport da raiz (zoom liberado). Com
 * `maximum-scale=1` o iPhone também para de ampliar a tela ao focar um campo.
 */
// viewport-fit=cover: com a barra do navegador recolhida, a página vai até a borda e o
// menu inferior respeita a safe-area (globals.css, .nav-rodape).
const VIEWPORT_SEM_ZOOM: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover' }

export async function generateViewport({ params }: { params: Promise<{ slug: string }> }): Promise<Viewport> {
  const { slug } = await params
  try {
    const loja = await carregarLoja(slug)
    if (!loja) return VIEWPORT_SEM_ZOOM
    // Mesma cor no tema claro e no escuro: a vitrine não tem modo escuro, e a barra tem que
    // combinar com a página nos dois.
    const cor = resolverPaleta(loja.corTema).primaria
    return { ...VIEWPORT_SEM_ZOOM, themeColor: [{ media: '(prefers-color-scheme: light)', color: cor }, { media: '(prefers-color-scheme: dark)', color: cor }] }
  } catch {
    return VIEWPORT_SEM_ZOOM
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const loja = await carregarLoja(slug)
    if (!loja) return { title: 'Loja não encontrada' }
    // Prévia do link (WhatsApp etc.): imagem própria da loja, JPEG 1200×630 < 300 KB, com
    // versão na URL para o WhatsApp buscar de novo quando a capa muda (lib/previa-loja.ts).
    const base = urlPublica()
    const v = versaoPrevia({ nome: loja.nome, bannerUrl: loja.bannerUrl ?? null, logoUrl: loja.logoUrl ?? null, cor: resolverPaleta(loja.corTema).primaria })
    const imagem = { url: `${base}/api/loja/${loja.slug}/previa?v=${v}`, width: PREVIA_LARGURA, height: PREVIA_ALTURA, type: 'image/jpeg', alt: loja.nome }
    const descricao = `Peça online no ${loja.nome}.`
    return {
      metadataBase: new URL(base),
      title: loja.nome,
      description: descricao,
      openGraph: { type: 'website', title: loja.nome, description: descricao, url: `${base}/loja/${loja.slug}`, siteName: loja.nome, images: [imagem] },
      twitter: { card: 'summary_large_image', title: loja.nome, description: descricao, images: [imagem.url] },
      // App instalado por loja (abre sem barra do navegador): manifesto e ícones próprios.
      manifest: `/api/loja/${loja.slug}/manifest`,
      appleWebApp: { capable: true, title: loja.nome, statusBarStyle: 'default' as const },
      // O Next 15 emite só "mobile-web-app-capable"; o iOS antigo ainda lê a versão apple.
      other: { 'apple-mobile-web-app-capable': 'yes' },
      icons: { apple: [{ url: `/api/loja/${loja.slug}/icone/180?v=${v}`, sizes: '180x180', type: 'image/png' }] },
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
