import { precoPizzaSabores, separarSabores, juntarSabores, type RegraPrecoPizza } from '@/lib/pizza-preco'

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
export function resolverPizza({ itemNome, tamanho, saborTexto, catalogo, regra }: ResolverPizzaArgs): { base: number; saborNome: string } {
  // Loja que já existia antes do meio a meio pode ter sabor gravado com " / "
  // no próprio nome ("Frango / Catupiry"). A guarda de cadastro só impede nome
  // NOVO — o que já está no banco tem que continuar vendendo. Então antes de
  // separar, tenta casar o texto INTEIRO contra o catálogo: se bater, é um
  // sabor só e não se separa nada. O nome inteiro tem precedência sobre as
  // partes, mesmo quando as duas existem no catálogo.
  const inteiro = saborTexto.trim()
  const legado = inteiro ? catalogo.find((s) => chave(s.nome) === chave(inteiro)) : undefined

  const pedidos = legado ? [legado.nome] : separarSabores(saborTexto)
  if (pedidos.length === 0) throw new Error(`Selecione o sabor da pizza "${itemNome}"`)

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
    const preco = sabor.precoPorTamanho.get(tamanho.id)
    // Preço 0 é "ainda não precificado": nenhuma tela oferece esse sabor nesse tamanho,
    // então aceitar aqui só serviria para uma pizza sair de graça por POST direto.
    if (preco === undefined || !(preco > 0)) {
      throw new Error(`O sabor "${sabor.nome}" não é vendido no tamanho "${tamanho.nome}".`)
    }
    nomes.push(sabor.nome)
    precos.push(preco)
  }

  return { base: precoPizzaSabores(precos, regra), saborNome: juntarSabores(nomes) }
}
