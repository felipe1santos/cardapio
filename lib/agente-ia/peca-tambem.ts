import type { SupabaseClient } from '@supabase/supabase-js'
import type { ItemIa } from './cardapio'
import { emojiDoItem, linhaItem } from '@/lib/mensageria/formato'

/**
 * "Peça também" (order bump, 12/10/2026). Depois que o cliente escolhe os itens e ANTES do resumo, o SERVIDOR oferece
 * UMA vez por pedido até 2 sugestões do próprio cardápio: o acompanhamento e a bebida mais vendidos (últimos 60 dias),
 * disponíveis e que não estão no carrinho. Loja sem bebida nem acompanhamento: nada. Sem IA para escolher.
 */
const ACOMPANHAMENTO = /acompanh|porc|petisc|batata|frit|entrada/i
const BEBIDA = /bebida|refri|drink|suco|cerveja|agua/i
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

function tipoDoItem(i: ItemIa): 'acompanhamento' | 'bebida' | null {
  const cat = semAcento(i.categoria ?? '')
  if (BEBIDA.test(cat)) return 'bebida'
  if (ACOMPANHAMENTO.test(cat)) return 'acompanhamento'
  const e = emojiDoItem(i.nome)
  if (e === '🥤' || e === '🍺' || e === '💧') return 'bebida'
  if (e === '🍟') return 'acompanhamento'
  return null
}

export function sugestoesPecaTambem(itens: ItemIa[], noCarrinho: string[], vendas: Map<string, number>): ItemIa[] {
  const fora = new Set(noCarrinho)
  const melhor = (tipo: 'acompanhamento' | 'bebida') => itens
    .filter((i) => i.situacao === 'disponivel' && !fora.has(i.id) && i.preco > 0 && tipoDoItem(i) === tipo)
    .sort((a, b) => (vendas.get(b.id) ?? 0) - (vendas.get(a.id) ?? 0) || a.preco - b.preco)[0]
  return [melhor('acompanhamento'), melhor('bebida')].filter((x): x is ItemIa => !!x)
}

export function textoPecaTambem(s: ItemIa[]): string {
  return ['Quer acompanhar? 😋', '', ...s.map((i) => linhaItem(1, i.nome, i.preco).replace('*1x ', '*')), '', '_Se não quiser, é só dizer "não"._'].join('\n')
}

/** Quantidade vendida por item nos últimos 60 dias (pedidos não cancelados). Uma consulta, no máximo 3.000 linhas. */
export async function vendasPorItem(admin: SupabaseClient, restauranteId: string): Promise<Map<string, number>> {
  const desde = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const { data } = await admin.from('pedido_itens').select('item_id, quantidade, pedidos!inner(restaurante_id, criado_em, status)')
    .eq('pedidos.restaurante_id', restauranteId).gte('pedidos.criado_em', desde).neq('pedidos.status', 'cancelado').limit(3000)
  const m = new Map<string, number>()
  for (const r of (data ?? []) as { item_id: string | null; quantidade: number }[]) if (r.item_id) m.set(r.item_id, (m.get(r.item_id) ?? 0) + Number(r.quantidade))
  return m
}

/** Já ofereceu neste pedido? Vale a oferta feita depois do último pedido criado na conversa e há menos de 3 h. */
export function bumpJaOferecido(c: { ia_bump_em?: string | null; ia_pedido_em?: string | null } | null, agora: number): boolean {
  if (!c?.ia_bump_em) return false
  const em = Date.parse(c.ia_bump_em)
  if (agora - em > 3 * 3600_000) return false
  return !c.ia_pedido_em || em > Date.parse(c.ia_pedido_em)
}
