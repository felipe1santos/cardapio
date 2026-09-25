/**
 * Etiqueta do item — a mesma no delivery e no cardápio da mesa (QR).
 *
 * A regra morava dentro da vitrine, então o cardápio do QR não mostrava
 * etiqueta nenhuma: o lojista marcava "Mais pedido" ou punha o item em
 * promoção, via a pílula no celular do cliente de delivery, e nada aparecia
 * para quem estava sentado na mesa lendo o mesmo cardápio.
 *
 * Aqui a etiqueta é DADO (rótulo + cores), não JSX: a vitrine desenha com
 * Tailwind e a mesa com o CSS próprio dela, mas as duas dizem a mesma coisa,
 * com a mesma cor.
 *
 * O emoji é o que sobrevive à miniatura: em 10px, no meio de uma foto, a
 * silhueta colorida é reconhecida antes da palavra.
 */

export interface EstiloEtiqueta {
  label: string
  /** Classes Tailwind (vitrine). */
  cls: string
  /** As mesmas cores em hex, para superfícies com CSS próprio (cardápio da mesa). */
  fundo: string
  texto: string
}

export const ETIQUETAS_ITEM: Record<string, EstiloEtiqueta> = {
  mais_pedido: { label: '🔥 Mais pedido', cls: 'bg-[#FFF1DC] text-[#9A5B00]', fundo: '#FFF1DC', texto: '#9A5B00' },
  edicao_limitada: { label: '⏳ Edição limitada', cls: 'bg-[#FCE7F3] text-[#A81B60]', fundo: '#FCE7F3', texto: '#A81B60' },
  novo: { label: '✨ Novo', cls: 'bg-[#E0F2FE] text-[#0369A1]', fundo: '#E0F2FE', texto: '#0369A1' },
  favorito: { label: '⭐ Favorito da casa', cls: 'bg-[#EDE9FE] text-[#6D28D9]', fundo: '#EDE9FE', texto: '#6D28D9' },
  promocao: { label: '🏷️ Promoção', cls: 'bg-[#DCFCE7] text-[#15803D]', fundo: '#DCFCE7', texto: '#15803D' },
}

export interface ItemEtiquetavel {
  tag: string | null
  /** Preço promocional ativo, ou null. */
  promocaoPreco: number | null
  maisVendido?: boolean
}

/**
 * Etiqueta que o item mostra. Item com desconto ativo ganha a etiqueta de
 * promoção mesmo quando o lojista não marcou nada no cadastro — é o que faz a
 * oferta ser vista na lista.
 *
 * Uma só, nunca duas empilhadas: duas pílulas sobre a mesma foto se anulam.
 *
 * O favorito (estrela do Gestor, coluna `mais_vendido`) NÃO é etiqueta: ele virava
 * "🔥 Mais pedido" e sumia sempre que o item tinha etiqueta ou promoção — o lojista
 * marcava a estrela e não via nada no cardápio. Agora ele tem o selo próprio abaixo.
 */
export function tagDoItem(item: ItemEtiquetavel): string | null {
  if (item.tag) return item.tag
  if (item.promocaoPreco !== null) return 'promocao'
  return null
}

/**
 * Selo "★ Favorito": o mesmo favorito que o Gestor marca com a estrela, na vitrine e nos
 * dois QR (visualização e ativo). Texto, não só ícone — o leitor de tela diz "Favorito".
 * Convive com a etiqueta (promoção, novo…), mas não repete "Favorito da casa".
 */
export const SELO_FAVORITO = { label: '★ Favorito', fundo: '#FEF3C7', texto: '#92400E' } as const

export function mostraSeloFavorito(item: { maisVendido?: boolean; tag: string | null }): boolean {
  return item.maisVendido === true && item.tag !== 'favorito'
}

/** Estilo pronto da etiqueta do item, ou null quando não há etiqueta. */
export function etiquetaDoItem(item: ItemEtiquetavel): EstiloEtiqueta | null {
  const tag = tagDoItem(item)
  return tag ? (ETIQUETAS_ITEM[tag] ?? null) : null
}
