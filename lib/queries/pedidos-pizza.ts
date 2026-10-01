import { precoPizzaSabores, separarSabores, juntarSabores, type RegraPrecoPizza } from '@/lib/pizza-preco'
import { pizzaSemSabores, saboresDoTamanho } from '@/lib/pizza-sabores'

export interface SaborCatalogo {
  nome: string
  status: string
  /** tamanho_padrao_id → preço. Sem entrada, ou com preço 0, o sabor não é vendido nele. */
  precoPorTamanho: Map<string, number>
}

export interface TamanhoCatalogo {
  id: string
  nome: string
  maxSabores: number
}

export interface ResolverPizzaArgs {
  itemNome: string
  tamanho: TamanhoCatalogo
  /** O que veio da sacola: um nome, ou vários juntos por " / ". */
  saborTexto: string
  catalogo: SaborCatalogo[]
  regra: RegraPrecoPizza
  /** Preço do item: vale para pizza sem preço por sabor e para pizza sem sabores (lib/pizza-sabores). */
  itemPreco?: number
}

/** Comparação de nome tolerante a caixa e acento — o cliente manda o que a tela mostrou. */
function chave(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()
}

/**
 * Server-authoritative: o preço da pizza nunca vem do cliente. A sacola manda
 * tamanho e sabores por NOME, e aqui se confere tudo contra o catálogo do
 * tenant antes de calcular.
 */
export function resolverPizza({ itemNome, tamanho, saborTexto, catalogo, regra, itemPreco }: ResolverPizzaArgs): { base: number; saborNome: string } {
  // Mesma regra das telas (lib/pizza-sabores): o que é vendável neste tamanho e por quanto.
  const comPrecos = catalogo.map((s) => ({ nome: s.nome, status: s.status, precos: Object.fromEntries(s.precoPorTamanho) }))
  const vendaveis = saboresDoTamanho(comPrecos, tamanho.id, itemPreco)

  // Loja que já existia antes do meio a meio pode ter sabor gravado com " / "
  // no próprio nome ("Frango / Catupiry"). A guarda de cadastro só impede nome
  // NOVO — o que já está no banco tem que continuar vendendo. Então antes de
  // separar, tenta casar o texto INTEIRO contra o catálogo: se bater, é um
  // sabor só e não se separa nada. O nome inteiro tem precedência sobre as
  // partes, mesmo quando as duas existem no catálogo.
  const inteiro = saborTexto.trim()
  const legado = inteiro ? catalogo.find((s) => chave(s.nome) === chave(inteiro)) : undefined

  const pedidos = legado ? [legado.nome] : separarSabores(saborTexto)
  if (pedidos.length === 0) {
    // Pizza sem nenhum sabor cadastrado: o sabor não é obrigatório — sai pelo preço do item.
    if (itemPreco !== undefined && pizzaSemSabores(comPrecos)) return { base: itemPreco, saborNome: '' }
    throw new Error(`Selecione o sabor da pizza "${itemNome}"`)
  }

  if (pedidos.length > tamanho.maxSabores) {
    const limite = tamanho.maxSabores === 1 ? '1 sabor' : `${tamanho.maxSabores} sabores`
    throw new Error(`O tamanho "${tamanho.nome}" aceita no máximo ${limite}.`)
  }

  const vistos = new Set<string>()
  const nomes: string[] = []
  const precos: number[] = []

  for (const pedido of pedidos) {
    const k = chave(pedido)
    if (vistos.has(k)) throw new Error(`Sabor repetido na pizza "${itemNome}": "${pedido}".`)
    vistos.add(k)

    const sabor = catalogo.find((s) => chave(s.nome) === k)
    if (!sabor || sabor.status !== 'disponivel') {
      throw new Error(`Sabor "${pedido}" não está disponível no item "${itemNome}".`)
    }
    // Preço 0 é "ainda não precificado": nenhuma tela oferece esse sabor nesse tamanho
    // (salvo pizza sem preço por sabor, que vale o preço do item — lib/pizza-sabores).
    const preco = vendaveis.find((v) => chave(v.sabor.nome) === k)?.preco
    if (preco === undefined) {
      throw new Error(`O sabor "${sabor.nome}" não é vendido no tamanho "${tamanho.nome}".`)
    }
    nomes.push(sabor.nome)
    precos.push(preco)
  }

  return { base: precoPizzaSabores(precos, regra), saborNome: juntarSabores(nomes) }
}
