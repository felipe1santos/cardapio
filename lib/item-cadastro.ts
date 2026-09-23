/**
 * O que o cadastro de item não pode deixar passar.
 *
 * Dois casos vistos em produção:
 *
 *  - **Item a R$ 0,00 disponível na vitrine.** A `mama-pizza` tinha uma
 *    "ESFIHA DE OVOMALTINE" a zero, pedível. Preço zero é legítimo em item que
 *    cobra por tamanho (pizza, açaí por volume) — ali o preço sai do tamanho —,
 *    mas num item simples sem tamanho nenhum é cadastro pela metade, e o
 *    cliente leva de graça.
 *  - **Promoção igual ou maior que o preço.** O item mostrava a etiqueta
 *    "🏷️ Promoção" com desconto de R$ 0,00. Promoção que não desconta nada é
 *    promessa quebrada na vitrine.
 */

export interface ItemParaValidar {
  preco: number
  promocaoPreco: number | null
  /** 'pizza' cobra por tamanho; os outros dependem de ter tamanho cadastrado. */
  tipoItem: string
  /** Quantos tamanhos o item tem. Com tamanho, o preço-base pode ser 0. */
  qtdTamanhos: number
  /** Só item disponível é pedível — pausado/esgotado não chega ao cliente. */
  status: string
}

export const ERRO_PRECO_ZERO =
  'Este item ficaria de graça: defina o preço, ou cadastre tamanhos com preço antes de deixá-lo disponível.'
export const ERRO_PROMOCAO_SEM_DESCONTO = 'O preço promocional precisa ser MENOR que o preço normal.'

/** `null` = pode salvar. String = o que o lojista precisa arrumar antes. */
export function erroDoItem(item: ItemParaValidar): string | null {
  if (item.promocaoPreco !== null && item.promocaoPreco >= item.preco && item.preco > 0) {
    return ERRO_PROMOCAO_SEM_DESCONTO
  }
  // Pizza e item com tamanho têm o preço no tamanho, não na base.
  const precoVemDoTamanho = item.tipoItem === 'pizza' || item.qtdTamanhos > 0
  if (item.preco <= 0 && !precoVemDoTamanho && item.status === 'disponivel') {
    return ERRO_PRECO_ZERO
  }
  return null
}

/**
 * Aviso para a lista do gestor de cardápio: o que JÁ está cadastrado errado.
 * Diferente da validação de salvar, aqui nada é bloqueado — é um alerta sobre o
 * que já está no ar, para o lojista achar e consertar.
 */
export function avisoDoItem(item: ItemParaValidar): string | null {
  if (item.promocaoPreco !== null && item.promocaoPreco >= item.preco && item.preco > 0) {
    return 'A promoção não está descontando nada (preço promocional maior ou igual ao normal).'
  }
  const precoVemDoTamanho = item.tipoItem === 'pizza' || item.qtdTamanhos > 0
  if (item.preco <= 0 && !precoVemDoTamanho && item.status === 'disponivel') {
    return 'Este item está a R$ 0,00 e disponível: o cliente pode pedir de graça.'
  }
  return null
}
