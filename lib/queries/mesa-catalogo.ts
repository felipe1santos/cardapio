import type { SupabaseClient } from '@supabase/supabase-js'
import type { ItemCardapio } from '@/lib/queries/cardapio'
import { buscarRegraPrecoPizza, listarBordasPizza, listarMassasPizza, listarTamanhosPadraoPizza } from '@/lib/queries/pizza'
import type { ItemPrecificavel, PizzaDaLoja } from '@/lib/selecao-preco'

/**
 * O que o cardápio da mesa (QR) precisa saber de pizza: tamanhos padrão da loja (com
 * quantos sabores cabem), bordas, massas e a regra de preço do meio a meio. Loja sem
 * pizza devolve listas vazias; erro de leitura não derruba a página — a pizza só fica sem
 * essas opções.
 */
export async function carregarPizzaDaLoja(admin: SupabaseClient, restauranteId: string): Promise<PizzaDaLoja> {
  const [tamanhos, bordas, massas, regra] = await Promise.all([
    listarTamanhosPadraoPizza(admin, restauranteId).catch(() => []),
    listarBordasPizza(admin, restauranteId).catch(() => []),
    listarMassasPizza(admin, restauranteId).catch(() => []),
    buscarRegraPrecoPizza(admin, restauranteId).catch(() => 'media' as const),
  ])
  return {
    tamanhos: tamanhos.map((t) => ({ id: t.id, nome: t.nome, maxSabores: Math.max(1, t.maxSabores) })),
    bordas: bordas.map((b) => ({ nome: b.nome, preco: b.preco })),
    massas: massas.map((m) => ({ nome: m.nome, preco: m.preco })),
    regra,
  }
}

/** O item do catálogo no formato que o cálculo de preço da seleção usa. */
export function itemPrecificavel(i: ItemCardapio): ItemPrecificavel {
  return {
    preco: i.promocaoPreco ?? i.preco,
    tipoItem: i.tipoItem,
    tamanhos: [...i.tamanhos].sort((a, b) => a.posicao - b.posicao).map((t) => ({ nome: t.nome, preco: t.preco })),
    sabores: i.sabores
      .filter((s) => s.status === 'disponivel')
      .sort((a, b) => a.posicao - b.posicao)
      .map((s) => ({ nome: s.nome, precos: Object.fromEntries(s.precos.map((p) => [p.tamanhoPadraoId, p.preco])) })),
    grupos: i.grupos.map((g) => ({
      nome: g.nome,
      complementos: g.complementos.filter((c) => !c.pausado).map((c) => ({ nome: c.nome, preco: c.preco })),
    })),
  }
}
