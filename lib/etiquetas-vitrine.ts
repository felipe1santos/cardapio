/**
 * Etiquetas do produto na vitrine (2026-09-30). Hierarquia:
 *
 * PRINCIPAIS — pílulas coloridas acima do nome, no máximo 2, nesta ordem:
 *   1. Mais pedido 🔥  — a estrela do Gestor (mais_vendido), que antes aparecia como "Favorito";
 *   2. Novidade        — até `novidadeAte` (some sozinha depois);
 *   3. Edição limitada.
 * UTILITÁRIAS — informativas, discretas, abaixo da descrição e logo acima do preço:
 *   Item promocional · Entrega grátis (a partir de R$ X, da regra da loja) · Serve X pessoas.
 *
 * Item salvo antes da 0117 ainda pode ter só a `tag` antiga: ela é entendida aqui.
 * Cores medidas nas referências (docs/referencias/tags e vitrine/ref-destaques).
 */
export type EtiquetaPrincipal = 'mais_pedido' | 'novidade' | 'edicao_limitada'
export type EtiquetaUtil = 'item_promocional' | 'entrega_gratis' | 'serve'

export interface ItemComEtiquetas {
  maisVendido?: boolean
  tag?: string | null
  novidadeAte?: string | null
  edicaoLimitada?: boolean
  itemPromocional?: boolean
  entregaGratis?: boolean
  servePessoas?: number | null
}

export const ESTILO_PRINCIPAL: Record<EtiquetaPrincipal, { texto: string; icone: string; iconeDepois?: boolean; fundo: string; cor: string }> = {
  // Cor quente: âmbar claro de fundo, laranja escuro no texto; fogo DEPOIS do texto.
  mais_pedido: { texto: 'Mais pedido', icone: 'fogo', iconeDepois: true, fundo: '#FFEDD5', cor: '#9A3412' },
  // Verde medido na REF-DESTAQUES (balanço de branco corrigido; texto escurecido para leitura).
  novidade: { texto: 'Novidade', icone: 'brilho', fundo: '#A3F7B5', cor: '#14532D' },
  edicao_limitada: { texto: 'Edição limitada', icone: 'ampulheta', fundo: '#FCE7F3', cor: '#BE185D' },
}

export function etiquetasPrincipais(item: ItemComEtiquetas, agora: number = Date.now()): EtiquetaPrincipal[] {
  const novas = item.novidadeAte !== undefined || item.edicaoLimitada !== undefined
  const mais = item.maisVendido === true || (!novas && (item.tag === 'mais_pedido' || item.tag === 'favorito'))
  const novidade = item.novidadeAte ? Date.parse(item.novidadeAte) > agora : !novas && item.tag === 'novo'
  const limitada = item.edicaoLimitada === true || (!novas && item.tag === 'edicao_limitada')
  const lista: EtiquetaPrincipal[] = []
  if (mais) lista.push('mais_pedido')
  if (novidade) lista.push('novidade')
  if (limitada) lista.push('edicao_limitada')
  return lista.slice(0, 2)
}

export interface EtiquetaUtilVista { tipo: EtiquetaUtil; texto: string }

function brl(v: number): string {
  return `R$ ${v.toFixed(2).replace('.', ',').replace(',00', '')}`
}

export function etiquetasUtilitarias(item: ItemComEtiquetas, loja: { freteGratisAcima?: number | null } = {}): EtiquetaUtilVista[] {
  const novas = item.itemPromocional !== undefined
  const out: EtiquetaUtilVista[] = []
  if (item.itemPromocional === true || (!novas && item.tag === 'promocao')) out.push({ tipo: 'item_promocional', texto: 'Item promocional' })
  if (item.entregaGratis === true) {
    const minimo = Number(loja.freteGratisAcima) || 0
    out.push({ tipo: 'entrega_gratis', texto: minimo > 0 ? `Entrega grátis a partir de ${brl(minimo)}` : 'Entrega grátis' })
  }
  if (item.servePessoas && item.servePessoas > 0) out.push({ tipo: 'serve', texto: `Serve ${item.servePessoas} ${item.servePessoas === 1 ? 'pessoa' : 'pessoas'}` })
  return out
}

/** Percentual de desconto inteiro (25 para R$ 7,50 → R$ 5,63). */
export function percentualDesconto(preco: number, original: number): number {
  if (!(original > 0) || !(preco < original)) return 0
  return Math.round((1 - preco / original) * 100)
}
