import type { ItemCardapio } from '@/lib/queries/cardapio'
import type { PedidoCliente } from '@/lib/queries/pedidos'

/**
 * "Pedir de novo": remonta a sacola a partir de um pedido já feito.
 *
 * O histórico guarda só nomes (o cardápio muda: item sai, preço sobe, adicional
 * some), então a repetição casa por NOME com o cardápio de agora e recalcula
 * tudo pelo preço atual. O que não existe mais fica de fora e é devolvido em
 * `indisponiveis` — o cliente precisa saber o que não veio junto, senão
 * descobre no total.
 */
export interface LinhaRepetida {
  /** Chave única da linha na sacola (o mesmo item pode repetir com adicionais diferentes). */
  key: string
  itemId: string
  name: string
  imagemUrl: string | null
  qty: number
  unit: number
  addons: { nome: string; preco: number }[]
  obs: string
  tamanhoNome: string
  saborNome: string
  bordaNome: string
  massaNome: string
}

export interface ResultadoRepeticao {
  linhas: LinhaRepetida[]
  /** Itens do pedido antigo que sumiram do cardápio (ou estão pausados/esgotados). */
  indisponiveis: string[]
  /** Itens que voltaram sem algum adicional, porque o adicional não existe mais. */
  semAlgunsAdicionais: string[]
  /** Pizzas e afins: precisam ser montadas na ficha, não dá pra repetir às cegas. */
  precisamMontagem: string[]
}

/** Nome normalizado (sem acento, sem caixa) — é por ele que o histórico reencontra o item. */
function chave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/** Preço unitário atual do item, considerando tamanho escolhido e promoção. */
function precoAtual(item: ItemCardapio, tamanhoNome: string): number {
  if (tamanhoNome) {
    const tamanho = item.tamanhos.find((t) => chave(t.nome) === chave(tamanhoNome))
    if (tamanho) return tamanho.preco
  }
  return item.promocaoPreco ?? item.preco
}

/** Todos os complementos do item, de grupos e da lista solta, achatados por nome. */
function complementosPorNome(item: ItemCardapio): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const grupo of item.grupos) {
    for (const comp of grupo.complementos) {
      if (!comp.pausado) mapa.set(chave(comp.nome), comp.preco)
    }
  }
  for (const comp of item.complementos) mapa.set(chave(comp.nome), comp.preco)
  return mapa
}

export function montarRepeticaoPedido(pedido: PedidoCliente, cardapio: ItemCardapio[]): ResultadoRepeticao {
  const porNome = new Map(cardapio.map((i) => [chave(i.nome), i]))
  const resultado: ResultadoRepeticao = { linhas: [], indisponiveis: [], semAlgunsAdicionais: [], precisamMontagem: [] }

  for (const [indice, pedidoItem] of pedido.itens.entries()) {
    const item = porNome.get(chave(pedidoItem.nome))

    if (!item || item.status !== 'disponivel') {
      resultado.indisponiveis.push(pedidoItem.nome)
      continue
    }

    // Pizza tem sabor, borda e massa com preço próprio por tamanho — remontar
    // isso por nome erraria o valor. Melhor mandar o cliente pra ficha.
    if (item.tipoItem === 'pizza') {
      resultado.precisamMontagem.push(item.nome)
      continue
    }

    const disponiveis = complementosPorNome(item)
    const addons: { nome: string; preco: number }[] = []
    let perdeuAdicional = false
    for (const nome of pedidoItem.complementos) {
      const preco = disponiveis.get(chave(nome))
      if (preco === undefined) { perdeuAdicional = true; continue }
      addons.push({ nome, preco })
    }
    if (perdeuAdicional) resultado.semAlgunsAdicionais.push(item.nome)

    const base = precoAtual(item, pedidoItem.tamanhoNome)
    resultado.linhas.push({
      key: `${item.id}-rep-${indice}`,
      itemId: item.id,
      name: item.nome,
      imagemUrl: item.imagemUrl,
      qty: pedidoItem.quantidade,
      unit: base + addons.reduce((soma, a) => soma + a.preco, 0),
      addons,
      obs: pedidoItem.observacao,
      // Tamanho só vale se ainda existir com esse nome; senão volta no preço base.
      tamanhoNome: item.tamanhos.some((t) => chave(t.nome) === chave(pedidoItem.tamanhoNome)) ? pedidoItem.tamanhoNome : '',
      saborNome: '',
      bordaNome: '',
      massaNome: '',
    })
  }

  return resultado
}

/** Frase curta pro toast/aviso do que não veio junto na repetição. */
export function avisoRepeticao(r: ResultadoRepeticao): string | null {
  const partes: string[] = []
  if (r.indisponiveis.length > 0) {
    partes.push(`${r.indisponiveis.length === 1 ? 'Um item saiu' : `${r.indisponiveis.length} itens saíram`} do cardápio`)
  }
  if (r.precisamMontagem.length > 0) {
    partes.push(`${r.precisamMontagem.length === 1 ? 'uma pizza precisa' : 'algumas pizzas precisam'} ser montada de novo`)
  }
  if (r.semAlgunsAdicionais.length > 0) {
    partes.push('alguns adicionais mudaram')
  }
  if (partes.length === 0) return null
  // 'A, B e C' — juntar tudo com 'e' vira trava-língua.
  const ultima = partes.pop() as string
  return partes.length === 0 ? `${ultima}.` : `${partes.join(', ')} e ${ultima}.`
}
