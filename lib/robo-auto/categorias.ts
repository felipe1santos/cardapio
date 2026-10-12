/**
 * Cardápio pelo robô SEM IA (12/10/2026). Cliente que não sabe o que quer ("o que tem?", "não sei", "me mostra as opções")
 * recebe a lista numerada de CATEGORIAS da loja; responde o número ou o nome e recebe os ITENS daquela categoria (nome +
 * preço, só disponíveis, no máximo 15 e o resto no link). Escolheu o item: a IA entra para montar o pedido (se a loja
 * usa a IA); sem IA, o pedido é pelo link. Tudo lido do cardápio da loja (nada inventado). Puro.
 */
import type { ItemIa } from '@/lib/agente-ia/cardapio'
import { emojiDoItem, linhaItem, listaNumerada } from '@/lib/mensageria/formato'

export const MAX_ITENS_LISTA = 15
export const PREVIA_LINK_MS = 30 * 60_000

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const PEDE_OPCOES = /\b(o que (voces? |vcs? )?tem|nao sei( o que)?|me mostra (as )?(opcoes|categorias)|quais (sao )?as opcoes|que opcoes|o que tem (pra|para) (comer|beber)|me (mostra|manda) o que tem)\b/

export function pedeOpcoes(texto: string): boolean {
  const t = normalizar(texto)
  return t.length <= 80 && PEDE_OPCOES.test(t)
}

export interface CategoriaRobo { nome: string; itens: ItemIa[] }

/** Categorias com pelo menos 1 item disponível agora, na ordem do cardápio. */
export function categoriasDoCardapio(itens: ItemIa[]): CategoriaRobo[] {
  const mapa = new Map<string, ItemIa[]>()
  for (const i of itens) {
    if (i.situacao !== 'disponivel' || !i.categoria?.trim()) continue
    const lista = mapa.get(i.categoria) ?? []
    lista.push(i)
    mapa.set(i.categoria, lista)
  }
  return [...mapa.entries()].map(([nome, lista]) => ({ nome, itens: lista }))
}

export function textoCategorias(cats: CategoriaRobo[]): string {
  return ['Temos estas opções 👇', listaNumerada(cats.map((c) => c.nome)), 'Responda o número ou o nome.'].join('\n')
}

/** Número da lista (1…n) ou nome (inteiro ou contido na frase). Índice 0-based ou null. */
export function escolherOpcao(texto: string, nomes: string[]): number | null {
  const t = normalizar(texto)
  const n = /^(\d{1,3})$/.exec(t)?.[1]
  if (n) { const i = Number(n) - 1; return i >= 0 && i < nomes.length ? i : null }
  const norm = nomes.map(normalizar)
  const exato = norm.indexOf(t)
  if (exato >= 0) return exato
  const contido = norm.findIndex((x) => x.length >= 3 && (` ${t} `.includes(` ${x} `) || (x.endsWith('s') && ` ${t} `.includes(` ${x.slice(0, -1)} `))))
  return contido >= 0 ? contido : null
}

export function textoItensDaCategoria(cat: CategoriaRobo, link: string, comIa: boolean): string {
  const mostrados = cat.itens.slice(0, MAX_ITENS_LISTA)
  const resto = cat.itens.length - mostrados.length
  const linhas = [
    `${emojiDoItem(cat.nome) ? `${emojiDoItem(cat.nome)} ` : ''}*${cat.nome}*`,
    ...mostrados.map((i, n) => `${n + 1}. ${linhaItem(1, i.nome, i.preco).replace('*1x ', '*')}`),
    ...(resto > 0 ? [`+${resto} no cardápio completo: ${link}`] : []),
  ]
  return [...linhas, comIa ? 'Qual você quer? Responda o número ou o nome.' : `Para pedir, é só usar o link abaixo 👇\n${link}`].join('\n')
}

/** "sim"/"quero" logo depois de a loja perguntar "Quer fazer um pedido?" (sem citar item). */
export function respondeuSimAoPedido(texto: string, ultimaDaLoja: string | null): boolean {
  if (!ultimaDaLoja || !/quer fazer (um|o seu|seu) pedido\?/i.test(ultimaDaLoja)) return false
  const t = normalizar(texto)
  return /^(sim|s|isso|quero|claro|bora|pode ser|quero sim|sim quero|sim quero pedir|quero pedir|sim por favor)( (por favor|pedir|fazer))*$/.test(t)
}

/** Mostra a prévia do link (a imagem do cardápio) só na 1ª mensagem com link em 30 min da conversa. */
export function previaDoLink(texto: string, ultimaComLinkEm: string | null, agora: number): boolean {
  if (!/https?:\/\/\S+\/loja\//.test(texto)) return true
  return !ultimaComLinkEm || agora - Date.parse(ultimaComLinkEm) >= PREVIA_LINK_MS
}
