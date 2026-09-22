/**
 * O que a faixa promocional da vitrine mostra: imagens, um aviso em texto, ou nada.
 *
 * A loja tem três campos que podem preencher o mesmo espaço — a lista nova de
 * imagens, a imagem única antiga (`banner_promocional_url`, que continua valendo
 * para quem já tinha) e o aviso em texto. Decidir aqui, e não no meio do JSX,
 * deixa a precedência testável e igual na vitrine e na prévia do painel.
 *
 * Precedência: imagens ganham do texto. Quem subiu foto quis mostrar a foto; o
 * texto é a alternativa de quem não tem arte pronta. As duas coisas juntas na
 * mesma faixa brigariam pelo mesmo espaço.
 */

export const BANNER_PROMO_MAX_IMAGENS = 6
export const BANNER_PROMO_MAX_TEXTO = 140

export interface FontesBannerPromo {
  /** Lista nova (0077). */
  urls?: string[] | null
  /** Imagem única do cadastro antigo — continua valendo. */
  urlLegado?: string | null
  texto?: string | null
}

export type BannerPromo =
  | { tipo: 'imagens'; urls: string[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nenhum' }

export function bannerPromocional(fontes: FontesBannerPromo): BannerPromo {
  const urls = (fontes.urls ?? []).map((u) => u?.trim()).filter((u): u is string => !!u)
  // A imagem antiga entra no fim da lista, e não no lugar dela: a loja que subiu
  // fotos novas sem apagar a antiga vê as duas coisas, na ordem em que cadastrou.
  const legado = fontes.urlLegado?.trim()
  if (legado && !urls.includes(legado)) urls.push(legado)

  if (urls.length > 0) return { tipo: 'imagens', urls: urls.slice(0, BANNER_PROMO_MAX_IMAGENS) }

  const texto = fontes.texto?.trim()
  if (texto) return { tipo: 'texto', texto: texto.slice(0, BANNER_PROMO_MAX_TEXTO) }

  return { tipo: 'nenhum' }
}

/** True quando a faixa vira carrossel — uma imagem só não tem o que passar. */
export function ehCarrossel(banner: BannerPromo): boolean {
  return banner.tipo === 'imagens' && banner.urls.length > 1
}
