/**
 * Tags do produto na vitrine (2026-10-01, substitui as regras de 2026-09-30). Hierarquia:
 *
 * TOPO — na linha do nome, à direita (descem para a linha de baixo se o nome não couber),
 * no máximo 2, nesta ordem:
 *   1. Mais vendido   — automático: a estrela do Gestor (mais_vendido), a mesma regra do
 *                       antigo "★ Favorito"/"Mais pedido";
 *   2. Combo especial — combo_especial (0122);
 *   3. Oferta limitada — a antiga "Edição limitada" (mesma coluna edicao_limitada);
 *   4. Novidade       — até `novidadeAte`.
 * UTILITÁRIAS — abaixo da descrição, logo acima do preço:
 *   Serve até X pessoas · Item promocional · tag personalizada (texto da loja, preta ou azul).
 *
 * Item salvo antes da 0117 ainda pode ter só a `tag` antiga: ela é entendida aqui.
 * Cores medidas nas referências por scripts/vitrine/medir-cores-tags.mjs
 * (docs/referencias/vitrine-tags/).
 */
export type EtiquetaTopo = 'mais_vendido' | 'combo_especial' | 'oferta_limitada' | 'novidade'
export type EtiquetaUtil = 'serve' | 'item_promocional' | 'personalizada'
export type CorTagPersonalizada = 'preta' | 'azul'

export interface ItemComEtiquetas {
  maisVendido?: boolean
  tag?: string | null
  novidadeAte?: string | null
  comboEspecial?: boolean
  edicaoLimitada?: boolean
  itemPromocional?: boolean
  servePessoas?: number | null
  tagPersonalizada?: string | null
  tagPersonalizadaCor?: string | null
}

export type IconeEtiqueta = 'fogo' | 'diamante' | 'ampulheta' | 'brilho' | 'selo' | 'pessoas' | 'etiqueta' | 'ticket'

export interface EstiloTag { texto: string; icone: IconeEtiqueta | null; fundo: string; cor: string; corIcone?: string; peso: 500 | 600 | 700; /** Canto em px (padrão da caixa: 6). */ raio?: number }

export const ESTILO_TOPO: Record<EtiquetaTopo, EstiloTag> = {
  // "Mais vendido": vermelho rgb(232 0 2) e canto de 3px pedidos pelo dono (2026-10-01);
  // texto e fogo brancos, negrito.
  mais_vendido: { texto: 'Mais vendido', icone: 'fogo', fundo: '#E80002', cor: '#FFFFFF', peso: 700, raio: 3 },
  // REF-CORES (roxo do iFood): diamante #A135F4, texto #9A3AE1, fundo lilás da REF-TAGS.
  combo_especial: { texto: 'Combo especial', icone: 'diamante', fundo: '#F2EAFC', cor: '#9A3AE1', corIcone: '#A135F4', peso: 600 },
  // Sem referência em imagem: rosa da mesma família.
  oferta_limitada: { texto: 'Oferta limitada', icone: 'ampulheta', fundo: '#FCE7F3', cor: '#BE185D', peso: 600 },
  // Cores pedidas pelo dono (2026-10-01): fundo rgb(0 255 142 / 35%), texto rgb(0 45 3); ícone de selo.
  novidade: { texto: 'Novidade', icone: 'selo', fundo: 'rgb(0 255 142 / 35%)', cor: 'rgb(0 45 3)', peso: 600 },
}

export const ESTILO_UTIL = {
  // REF-TAGS "Serve 4 pessoas": cinza claro, texto e ícone quase pretos.
  serve: { fundo: '#F1F1F1', cor: '#0C0D18' },
  // REF-TAGS "Item promocional": azul claro, texto e etiqueta azuis.
  item_promocional: { fundo: '#EAF0F3', cor: '#17618B' },
  personalizada_preta: { fundo: '#1F1F1F', cor: '#FFFFFF' },
} as const

/** Desconto: verde da tag "R$ 5 off" da REF-CORES. Preço antigo: cinza claro. */
export const ESTILO_DESCONTO = { fundo: '#EAFFF5', cor: '#24A96A' } as const
export const COR_PRECO_ANTIGO = '#A1A1AA'

export const MAX_TOPO = 2
export const TAG_PERSONALIZADA_MAX = 24

/** Tags de topo ligadas, na ordem de prioridade (sem corte). */
export function etiquetasTopoLigadas(item: ItemComEtiquetas, agora: number = Date.now()): EtiquetaTopo[] {
  // A tag antiga só existe em item que ainda não foi salvo pelo formulário novo (ele zera a
  // tag): vale junto com as colunas novas, para nada sumir de quem ainda não migrou.
  const lista: EtiquetaTopo[] = []
  if (item.maisVendido === true || item.tag === 'mais_pedido' || item.tag === 'favorito') lista.push('mais_vendido')
  if (item.comboEspecial === true) lista.push('combo_especial')
  if (item.edicaoLimitada === true || item.tag === 'edicao_limitada') lista.push('oferta_limitada')
  if ((item.novidadeAte ? Date.parse(item.novidadeAte) > agora : false) || item.tag === 'novo') lista.push('novidade')
  return lista
}

/** As que aparecem: no máximo 2 (1 sobre a foto dos destaques). */
export function etiquetasTopo(item: ItemComEtiquetas, max: number = MAX_TOPO, agora: number = Date.now()): EtiquetaTopo[] {
  return etiquetasTopoLigadas(item, agora).slice(0, Math.max(0, Math.min(max, MAX_TOPO)))
}

/** Texto da tag personalizada já limpo (uma linha, até 24). Vazio = null. */
export function limparTagPersonalizada(texto: string | null | undefined): string | null {
  if (!texto) return null
  const t = texto.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, TAG_PERSONALIZADA_MAX).trim()
  return t || null
}

/** Mensagem de erro da tag personalizada (para o formulário e o servidor), ou null. */
export function motivoTagPersonalizadaInvalida(texto: string | null | undefined, cor: string | null | undefined): string | null {
  if (texto === null || texto === undefined || texto.trim() === '') return null
  if (/[\r\n]/.test(texto)) return 'A tag personalizada tem que ser de uma linha.'
  if (texto.trim().length > TAG_PERSONALIZADA_MAX) return `A tag personalizada tem no máximo ${TAG_PERSONALIZADA_MAX} caracteres.`
  if (cor !== 'preta' && cor !== 'azul') return 'Escolha a cor da tag personalizada: preta ou azul.'
  return null
}

export function textoServe(n: number): string {
  return n === 1 ? 'Serve 1 pessoa' : `Serve até ${n} pessoas`
}

export type EtiquetaUtilVista =
  | { tipo: 'serve'; texto: string }
  | { tipo: 'item_promocional'; texto: string }
  | { tipo: 'personalizada'; texto: string; cor: CorTagPersonalizada }

export function etiquetasUtilitarias(item: ItemComEtiquetas): EtiquetaUtilVista[] {
  const out: EtiquetaUtilVista[] = []
  if (item.servePessoas && item.servePessoas > 0) out.push({ tipo: 'serve', texto: textoServe(Math.round(item.servePessoas)) })
  if (item.itemPromocional === true || item.tag === 'promocao') out.push({ tipo: 'item_promocional', texto: 'Item promocional' })
  const pers = limparTagPersonalizada(item.tagPersonalizada)
  if (pers) out.push({ tipo: 'personalizada', texto: pers, cor: item.tagPersonalizadaCor === 'azul' ? 'azul' : 'preta' })
  // Nunca duas iguais (ex.: personalizada escrita "Item promocional" com a promocional ligada).
  const vistos = new Set<string>()
  return out.filter((e) => {
    const k = e.texto.toLocaleLowerCase('pt-BR')
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  })
}

/** Percentual de desconto inteiro (25 para R$ 7,50 → R$ 5,63). */
export function percentualDesconto(preco: number, original: number): number {
  if (!(original > 0) || !(preco < original)) return 0
  return Math.round((1 - preco / original) * 100)
}
