import { precoPizzaSabores, type RegraPrecoPizza } from '@/lib/pizza-preco'

/**
 * Preço de uma linha da seleção da mesa (cardápio do QR), a partir do catálogo.
 *
 * O mesmo cálculo roda no celular do cliente (subtotal na tela) e no servidor (que grava
 * a seleção com o preço do catálogo, nunca o do navegador). Regras, iguais às do pedido
 * oficial (`criarPedido`):
 *
 *  - pizza: o preço-base é o dos sabores no tamanho escolhido (média ou maior, conforme a
 *    loja); borda, massa e adicionais somam;
 *  - item com tamanhos: o tamanho SUBSTITUI o preço-base (não soma);
 *  - adicionais: preço do catálogo, pelo nome dentro do grupo.
 *
 * A seleção é só uma lista para o garçom: quem lança e cobra é ele, e o lançamento é
 * reprecificado de novo no servidor.
 */

export type TipoOpcao = 'tamanho' | 'sabor' | 'borda' | 'massa' | 'opcao'

export interface OpcaoDaLinha {
  grupo: string
  escolha: string
  preco: number
  /** O que a opção é. Ausente em seleção gravada antes da pizza no salão = adicional. */
  tipo?: TipoOpcao
}

export interface PizzaDaLoja {
  tamanhos: { id: string; nome: string; maxSabores: number }[]
  bordas: { nome: string; preco: number }[]
  massas: { nome: string; preco: number }[]
  regra: RegraPrecoPizza
}

export interface ItemPrecificavel {
  /** Preço-base já com promoção. */
  preco: number
  tipoItem: string
  tamanhos: { nome: string; preco: number }[]
  /** Só sabores disponíveis. `precos` = id do tamanho padrão → preço. */
  sabores: { nome: string; precos: Record<string, number> }[]
  grupos: { nome: string; complementos: { nome: string; preco: number }[] }[]
}

export const GRUPO_TAMANHO_LEGADO = 'Escolha o tamanho'

export function tipoDaOpcao(o: Pick<OpcaoDaLinha, 'grupo' | 'tipo'>): TipoOpcao {
  if (o.tipo) return o.tipo
  return o.grupo === GRUPO_TAMANHO_LEGADO ? 'tamanho' : 'opcao'
}

export interface LinhaPrecificada {
  precoUnitario: number
  opcoes: OpcaoDaLinha[]
  /** Tem o que é obrigatório para esse tipo de item (tamanho; sabor na pizza). */
  completa: boolean
}

export function precificarLinha(item: ItemPrecificavel, opcoes: OpcaoDaLinha[], pizza: PizzaDaLoja): LinhaPrecificada {
  const doTipo = (t: TipoOpcao) => opcoes.filter((o) => tipoDaOpcao(o) === t)
  const saida: OpcaoDaLinha[] = []
  let base = item.preco
  let completa = true

  if (item.tipoItem === 'pizza') {
    const tamanho = pizza.tamanhos.find((t) => t.nome === doTipo('tamanho')[0]?.escolha)
    const sabores = tamanho
      ? doTipo('sabor')
          .map((o) => item.sabores.find((s) => s.nome === o.escolha))
          .filter((s): s is ItemPrecificavel['sabores'][number] => !!s && (s.precos[tamanho.id] ?? 0) > 0)
          .slice(0, Math.max(1, tamanho.maxSabores))
      : []
    completa = !!tamanho && sabores.length > 0
    if (tamanho) saida.push({ grupo: 'Tamanho', escolha: tamanho.nome, preco: 0, tipo: 'tamanho' })
    for (const s of sabores) saida.push({ grupo: 'Sabor', escolha: s.nome, preco: 0, tipo: 'sabor' })
    if (completa) base = precoPizzaSabores(sabores.map((s) => s.precos[tamanho!.id]!), pizza.regra)

    const borda = pizza.bordas.find((b) => b.nome === doTipo('borda')[0]?.escolha)
    if (borda) saida.push({ grupo: 'Borda', escolha: borda.nome, preco: borda.preco, tipo: 'borda' })
    const massa = pizza.massas.find((m) => m.nome === doTipo('massa')[0]?.escolha)
    if (massa) saida.push({ grupo: 'Massa', escolha: massa.nome, preco: massa.preco, tipo: 'massa' })
  } else if (item.tamanhos.length > 0) {
    const tamanho = item.tamanhos.find((t) => t.nome === doTipo('tamanho')[0]?.escolha)
    completa = !!tamanho
    if (tamanho) {
      base = tamanho.preco
      saida.push({ grupo: 'Tamanho', escolha: tamanho.nome, preco: 0, tipo: 'tamanho' })
    }
  }

  // Adicionais: preço do catálogo. Opção que não existe mais continua visível para o
  // garçom (é o que o cliente pediu), mas sem valor.
  for (const o of doTipo('opcao')) {
    const grupo = item.grupos.find((g) => g.nome === o.grupo)
    const achada =
      grupo?.complementos.find((c) => c.nome === o.escolha) ??
      item.grupos.flatMap((g) => g.complementos).find((c) => c.nome === o.escolha)
    saida.push({ grupo: o.grupo, escolha: o.escolha, preco: achada ? achada.preco : 0, tipo: 'opcao' })
  }

  return { precoUnitario: base, opcoes: saida, completa }
}

/** Menor preço possível do item — o "a partir de" do cartão. */
export function precoAPartirDe(item: ItemPrecificavel, pizza: PizzaDaLoja): number {
  if (item.tipoItem === 'pizza') {
    const ids = new Set(pizza.tamanhos.map((t) => t.id))
    const precos = item.sabores.flatMap((s) => Object.entries(s.precos).filter(([id]) => ids.has(id)).map(([, p]) => p).filter((p) => p > 0))
    return precos.length ? Math.min(...precos) : item.preco
  }
  if (item.tamanhos.length > 0) return Math.min(...item.tamanhos.map((t) => t.preco))
  return item.preco
}
