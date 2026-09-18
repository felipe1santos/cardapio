/**
 * Em que canal um item do cardápio pode ser vendido.
 *
 * Existe um catálogo só. Delivery (`/loja/[slug]`), salão (`/mesa/[token]` e o painel do
 * garçom) e balcão (PDV) leem as MESMAS linhas de `itens_cardapio` — com a mesma foto,
 * descrição, preço, promoção, complementos, obrigatórios, tamanhos, sabores e dias.
 * Nada é copiado nem sincronizado.
 *
 * A única coisa que varia por canal é se o item aparece, e isso mora em duas colunas do
 * próprio item (0069). Esta função é o lugar ÚNICO onde essa regra é aplicada, para a
 * vitrine, a mesa, o garçom e a validação do servidor não divergirem.
 */

export type CanalVenda = 'delivery' | 'mesa' | 'balcao'

export interface ItemComCanais {
  disponivelDelivery: boolean
  disponivelSalao: boolean
}

/**
 * O balcão (PDV) segue o salão: é atendimento presencial, a mesma decisão comercial.
 * Dar uma terceira coluna ao PDV obrigaria o dono a marcar três caixinhas por item sem
 * nenhum caso real de uso pedindo isso.
 */
export function itemDisponivelNoCanal(item: ItemComCanais, canal: CanalVenda): boolean {
  if (canal === 'delivery') return item.disponivelDelivery
  return item.disponivelSalao
}

/**
 * A categoria do item está no horário agora? Mesma regra da vitrine
 * (`listarCardapioPublico` → `grupoEstaAtivoAgora`): categoria com janela de horário
 * (almoço, noite) só vende dentro dela, em QUALQUER canal. Item sem categoria não tem
 * janela. `categorias` precisa trazer os horários (`GrupoCardapio`).
 */
export function categoriaNoHorario(
  item: { grupoId: string | null },
  categorias: { id: string; horarioAtivoInicio: string | null; horarioAtivoFim: string | null }[],
  estaAtiva: (g: { horarioAtivoInicio: string | null; horarioAtivoFim: string | null }) => boolean,
): boolean {
  if (!item.grupoId) return true
  const categoria = categorias.find((g) => g.id === item.grupoId)
  return categoria ? estaAtiva(categoria) : true
}

export const ROTULO_CANAL: Record<CanalVenda, string> = {
  delivery: 'Delivery',
  mesa: 'Salão',
  balcao: 'Balcão',
}

/** Texto curto para o admin ver de relance onde o item está no ar. */
export function resumoCanais(item: ItemComCanais): string {
  if (item.disponivelDelivery && item.disponivelSalao) return 'Delivery e salão'
  if (item.disponivelDelivery) return 'Só delivery'
  if (item.disponivelSalao) return 'Só salão'
  // O CHECK da 0069 impede gravar isso; a função não mente se aparecer um dado antigo.
  return 'Fora dos dois canais'
}

/**
 * Mensagem que o garçom lê quando o item saiu do ar entre o cliente marcar e ele lançar.
 * Fica aqui junto da regra para o texto não ser inventado de novo em cada tela.
 */
export function motivoIndisponivel(motivo: 'inexistente' | 'status' | 'dia' | 'horario' | 'canal', nome: string): string {
  if (motivo === 'inexistente') return `"${nome}" não está mais no cardápio.`
  if (motivo === 'status') return `"${nome}" está pausado ou esgotado.`
  if (motivo === 'dia') return `"${nome}" não é servido hoje.`
  if (motivo === 'horario') return `"${nome}" é de uma categoria fora do horário agora.`
  return `"${nome}" não é vendido no salão.`
}
