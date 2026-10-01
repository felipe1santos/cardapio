/**
 * Avisos ao salvar um produto no Cardápio (2026-10-01): o que deixaria o cliente/operador sem
 * opção para escolher. Não bloqueia o salvamento — a venda nunca trava por isso (grupo
 * obrigatório sem opções deixa de ser exigido), mas a loja precisa saber para corrigir.
 */
import { tamanhoOcultoNaPizza, type PrecosDoSabor } from './pizza-tamanhos'
import { pizzaSemSabores, saboresDoTamanho } from './pizza-sabores'

export interface ItemParaAvisos {
  nome: string
  tipoItem: string
  preco: number
  sabores: { nome: string; status: string; precos: PrecosDoSabor }[]
  pizzaTamanhosOcultos?: string[] | null
  grupos: { nome: string; obrigatorio: boolean; complementos: { pausado: boolean }[] }[]
}

export function avisosDoCadastro(item: ItemParaAvisos, tamanhosPizza: { id: string; nome: string }[]): string[] {
  const avisos: string[] = []
  if (item.tipoItem === 'pizza') {
    if (pizzaSemSabores(item.sabores)) {
      avisos.push(`"${item.nome}" não tem nenhum sabor cadastrado: a pizza sai sem sabor, pelo preço do item.`)
    } else {
      for (const t of tamanhosPizza) {
        if (tamanhoOcultoNaPizza(item.pizzaTamanhosOcultos, t.id)) continue
        if (saboresDoTamanho(item.sabores, t.id, item.preco).length === 0) {
          avisos.push(`O tamanho ${t.nome} não tem nenhum sabor disponível — cadastre o preço ou desligue o tamanho nesta pizza.`)
        }
      }
    }
  }
  for (const g of item.grupos) {
    if (g.obrigatorio && !g.complementos.some((c) => !c.pausado)) {
      avisos.push(`O grupo obrigatório "${g.nome}" não tem nenhuma opção disponível — ele não será exigido até ter opções.`)
    }
  }
  return avisos
}
