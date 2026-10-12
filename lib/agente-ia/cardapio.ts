/**
 * Agente de IA — o cardápio que a IA enxerga. O prompt fixo leva só um RESUMO (nome + preço + categoria, dos itens à
 * venda no delivery); detalhes (descrição, adicionais, tamanhos, sabores, disponibilidade) vêm pela ferramenta
 * consultar_cardapio. Preço final do pedido NUNCA vem daqui: é recalculado no servidor (precificarLinhas).
 * Leitura do banco próprio, sem API paga; guardada 60 s por loja para não reler a cada mensagem.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTexto } from '@/lib/robo-auto/classificador'
import { promocaoVigente } from '@/lib/promocao-agenda'
import { itemDisponivelHoje } from '@/lib/timezone'

export interface GrupoIa { nome: string; obrigatorio: boolean; min: number; max: number; opcoes: { nome: string; preco: number; pausado: boolean }[] }
export interface ItemIa {
  id: string
  nome: string
  descricao: string
  categoria: string
  posicao: number
  /** Preço agora (promoção vigente já aplicada). */
  preco: number
  precoCheio: number | null
  /** disponivel | pausado | esgotado | fora_do_dia */
  situacao: string
  tipo: string
  grupos: GrupoIa[]
  tamanhos: { nome: string; preco: number }[]
  sabores: string[]
}
export interface CardapioIa {
  itens: ItemIa[]
  pizza: { tamanhos: { nome: string; maxSabores: number }[]; bordas: { nome: string; preco: number }[]; massas: { nome: string; preco: number }[] }
}

const CACHE_MS = 60_000
const cache = new Map<string, { em: number; valor: CardapioIa }>()

type Linha = Record<string, unknown>
const num = (v: unknown) => Number(v) || 0

export async function carregarCardapioIa(admin: SupabaseClient, restauranteId: string, agora = new Date()): Promise<CardapioIa> {
  const c = cache.get(restauranteId)
  if (c && agora.getTime() - c.em < CACHE_MS) return c.valor
  const [{ data: itens }, { data: tam }, { data: bordas }, { data: massas }] = await Promise.all([
    admin
      .from('itens_cardapio')
      .select(`id, nome, descricao, preco, promocao_preco, promocao_inicio, promocao_fim, promocao_dias, promocao_hora_inicio, promocao_hora_fim,
        status, tipo_item, dias_disponiveis, disponivel_delivery, posicao,
        grupos_cardapio ( nome, posicao ),
        item_complementos ( nome, preco, pausado, grupo_id, posicao ),
        grupos_item_complementos ( id, nome, obrigatorio, min_escolhas, max_escolhas, posicao ),
        tamanhos_item ( nome, preco, posicao ),
        pizza_sabores ( nome, status, posicao )`)
      .eq('restaurante_id', restauranteId)
      .limit(800),
    admin.from('tamanhos_padrao_pizza').select('nome, max_sabores').eq('restaurante_id', restauranteId),
    admin.from('bordas_pizza').select('nome, preco').eq('restaurante_id', restauranteId),
    admin.from('massas_pizza').select('nome, preco').eq('restaurante_id', restauranteId),
  ])
  const lista: ItemIa[] = ((itens ?? []) as Linha[])
    .filter((i) => i.disponivel_delivery !== false)
    .map((i) => {
      const promo = i.promocao_preco !== null && i.promocao_preco !== undefined && promocaoVigente({
        promocaoInicio: i.promocao_inicio as string | null, promocaoFim: i.promocao_fim as string | null, promocaoDias: i.promocao_dias as number[] | null,
        promocaoHoraInicio: i.promocao_hora_inicio as string | null, promocaoHoraFim: i.promocao_hora_fim as string | null,
      }, agora)
      const grupoCat = i.grupos_cardapio as { nome?: string; posicao?: number } | null
      const gruposDb = ((i.grupos_item_complementos ?? []) as Linha[]).sort((a, b) => num(a.posicao) - num(b.posicao))
      const comps = ((i.item_complementos ?? []) as Linha[]).sort((a, b) => num(a.posicao) - num(b.posicao))
      const status = String(i.status ?? 'disponivel')
      return {
        id: String(i.id),
        nome: String(i.nome ?? ''),
        descricao: String(i.descricao ?? '').slice(0, 240),
        categoria: grupoCat?.nome ?? 'Outros',
        posicao: num(grupoCat?.posicao) * 10_000 + num(i.posicao),
        preco: promo ? num(i.promocao_preco) : num(i.preco),
        precoCheio: promo ? num(i.preco) : null,
        situacao: status !== 'disponivel' ? status : itemDisponivelHoje((i.dias_disponiveis as number[] | null) ?? [], agora) ? 'disponivel' : 'fora_do_dia',
        tipo: String(i.tipo_item ?? 'simples'),
        grupos: gruposDb.map((g) => ({
          nome: String(g.nome), obrigatorio: g.obrigatorio === true, min: num(g.min_escolhas), max: num(g.max_escolhas),
          opcoes: comps.filter((o) => o.grupo_id === g.id).map((o) => ({ nome: String(o.nome), preco: num(o.preco), pausado: o.pausado === true })),
        })),
        tamanhos: ((i.tamanhos_item ?? []) as Linha[]).sort((a, b) => num(a.posicao) - num(b.posicao)).map((t) => ({ nome: String(t.nome), preco: num(t.preco) })),
        sabores: ((i.pizza_sabores ?? []) as Linha[]).filter((s) => s.status === 'disponivel').sort((a, b) => num(a.posicao) - num(b.posicao)).map((s) => String(s.nome)),
      }
    })
    .sort((a, b) => a.posicao - b.posicao)
  const valor: CardapioIa = {
    itens: lista,
    pizza: {
      tamanhos: ((tam ?? []) as Linha[]).map((t) => ({ nome: String(t.nome), maxSabores: Math.max(1, num(t.max_sabores)) })),
      bordas: ((bordas ?? []) as Linha[]).map((b) => ({ nome: String(b.nome), preco: num(b.preco) })),
      massas: ((massas ?? []) as Linha[]).map((m) => ({ nome: String(m.nome), preco: num(m.preco) })),
    },
  }
  cache.set(restauranteId, { em: agora.getTime(), valor })
  if (cache.size > 500) cache.delete(cache.keys().next().value as string)
  return valor
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

/** Resumo do prompt fixo: "## Categoria" + "- Nome — R$ 0,00". Só o que está à venda hoje. Até 250 itens. */
export function resumoDoCardapio(c: CardapioIa): string {
  const linhas: string[] = []
  let categoria = ''
  for (const i of c.itens.filter((x) => x.situacao === 'disponivel').slice(0, 250)) {
    if (i.categoria !== categoria) { categoria = i.categoria; linhas.push(`## ${categoria}`) }
    const preco = i.tipo === 'pizza' ? 'pizza (preço pelo tamanho e sabores)' : i.tamanhos.length ? `a partir de ${brl(Math.min(...i.tamanhos.map((t) => t.preco)))}` : brl(i.preco)
    linhas.push(`- ${i.nome} — ${preco}${i.precoCheio ? ` (promoção; antes ${brl(i.precoCheio)})` : ''}`)
  }
  return linhas.join('\n') || '(cardápio vazio)'
}

/**
 * Nome de item/busca no mesmo formato (12/10, teste do Felipe): sem acento e hífen, "xburger"/"xtudo" → "x burger"/"x tudo",
 * e as grafias de hambúrguer (hamburguer, hamburger, burguer) viram "burger". Vale para a busca e para o nome do item.
 */
export function normalizarNomeItem(s: string): string {
  return normalizarTexto(s.replace(/[-/]/g, ' '))
    .replace(/\bx(?=[a-z]{3,})/g, 'x ')
    .replace(/\b(ham)?burg(u?er|uer)\b/g, 'burger')
}

/** Busca da ferramenta: nome e descrição, sem acento, tolerante; os mais parecidos primeiro. Nada pelo nome → a categoria da família ("refri" → Bebidas). */
export function buscarNoCardapio(c: CardapioIa, busca: string, limite = 6): ItemIa[] {
  const termos = normalizarNomeItem(busca).split(' ').filter((t) => t.length >= 2)
  if (!termos.length) return []
  const pontos = c.itens.map((i) => {
    const nome = normalizarNomeItem(i.nome)
    const desc = normalizarTexto(i.descricao)
    const cat = normalizarTexto(i.categoria)
    let p = 0
    for (const t of termos) {
      if (nome.split(' ').includes(t)) p += 3
      else if (nome.includes(t)) p += 2
      else if (cat.includes(t)) p += 1
      else if (desc.includes(t)) p += 1
    }
    return { i, p }
  })
  const achados = pontos.filter((x) => x.p > 0).sort((a, b) => b.p - a.p).slice(0, limite).map((x) => x.i)
  if (achados.length) return achados
  const familia = familiaDaBusca(busca)
  return familia ? c.itens.filter((i) => familia.categoria.test(normalizarTexto(i.categoria))).slice(0, limite) : []
}

const FAMILIAS: [RegExp, RegExp, string][] = [
  [/\b(x|xis|burg|burger|hamburg|hamburguer|lanche|sanduiche|smash|bacon|salada|egg|cheddar)/, /lanche|burg|hamb|sanduich|smash/, 'lanche'],
  [/\b(pizza|calabresa|mussarela|marguerita|portuguesa|frango com)/, /pizza/, 'pizza'],
  [/\b(coca|guarana|refri|refrigerante|suco|agua|cerveja|bebida|lata|fanta|sprite|pepsi|2l|600ml|litro)/, /bebida|refri|suco|drink/, 'bebida'],
  [/\b(acai|sorvete|doce|sobremesa|milk|shake|brownie)/, /acai|sobremesa|doce|sorvete/, 'sobremesa'],
  [/\b(batata|porcao|frita|nugget|onion|isca)/, /porc|batata|acompanh|petisc/, 'porção'],
]

/** Família do que o cliente pediu ("um refri" → bebida), ou null. Usada quando a loja não tem nada daquilo. */
export function familiaDaBusca(busca: string): { rotulo: string; categoria: RegExp } | null {
  const f = FAMILIAS.find(([pedido]) => pedido.test(normalizarTexto(busca.replace(/[-/]/g, ' '))))
  return f ? { rotulo: f[2], categoria: f[1] } : null
}

/**
 * Item pedido não existe (ex.: "x-tudo"): até 3 itens DISPONÍVEIS da mesma família (lanche, pizza, bebida, doce, porção),
 * pela categoria ou pelo nome; sem família reconhecida, os primeiros disponíveis. A IA sugere estes com o preço.
 */
export function sugerirParecidos(c: CardapioIa, busca: string, limite = 3): ItemIa[] {
  const alvo = normalizarTexto(busca.replace(/[-/]/g, ' '))
  const disp = c.itens.filter((i) => i.situacao === 'disponivel')
  const familia = FAMILIAS.find(([pedido]) => pedido.test(alvo))
  if (familia) {
    const [, categoria] = familia
    const daFamilia = disp.filter((i) => categoria.test(normalizarTexto(i.categoria)) || categoria.test(normalizarTexto(i.nome)) || familia[0].test(normalizarTexto(i.nome)))
    if (daFamilia.length) return daFamilia.slice(0, limite)
  }
  return disp.slice(0, limite)
}

/** Só para os testes. */
export function _zerarCacheCardapio() { cache.clear() }
