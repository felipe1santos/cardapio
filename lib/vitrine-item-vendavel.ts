import type { ItemCardapio } from '@/lib/queries/cardapio'

/**
 * O item pode aparecer na vitrine? (2026-09-30)
 *
 * Fica de fora o que sairia como "R$ 0,00" sem que nada possa formar preço: item simples,
 * sem tamanho, sem sabores, sem complementos e com preço zero — e item sem nome ou com nome
 * que é um código (UUID). Esses vinham do upload de fotos em lote (nome do arquivo) e da
 * criação rápida, e apareciam para o cliente como "B2ab1fe1 Dd8c… · Sem descrição · R$ 0,00".
 *
 * Pizza, item com tamanho e "monte seu açaí" (base 0 + opções pagas) continuam aparecendo:
 * o preço vem das escolhas. Item grátis de verdade sai por prêmio/cupom, não por preço 0.
 */
const PARECE_CODIGO = /^[0-9a-f]{8}[\s\-_]?[0-9a-f]{4}[\s\-_]?[0-9a-f]{4}[\s\-_]?[0-9a-f]{4}[\s\-_]?[0-9a-f]{12}$/i

export function itemVendavelNaVitrine(item: Pick<ItemCardapio, 'nome' | 'preco' | 'promocaoPreco' | 'tipoItem' | 'tamanhos' | 'sabores' | 'grupos' | 'complementos'>): boolean {
  const nome = (item.nome ?? '').trim()
  if (!nome || PARECE_CODIGO.test(nome)) return false
  const temOndeFormarPreco =
    item.tipoItem === 'pizza' ||
    (item.tamanhos?.length ?? 0) > 0 ||
    (item.sabores?.length ?? 0) > 0 ||
    (item.grupos?.length ?? 0) > 0 ||
    (item.complementos?.length ?? 0) > 0
  const preco = Number(item.promocaoPreco ?? item.preco) || 0
  return preco > 0 || temOndeFormarPreco
}
