/**
 * Formatação das mensagens do WhatsApp (12/10/2026) — a MESMA para robô, Agente de IA e avisos de status. Pura.
 * - Negrito só no que importa (nome do item, total, nº do pedido); fundo cinza (`crase`) para valores e dados.
 * - Emoji por item/complemento vem de uma tabela fixa por palavra-chave (sem IA), no máximo 1 por linha; sem
 *   correspondência, sem emoji.
 * - Complemento grátis não mostra preço. Listas: uma opção por linha (numeradas quando é para escolher).
 */
const EMOJIS: [RegExp, string][] = [
  [/\b(hot ?dog|cachorro quente)\b/, '🌭'],
  [/(^x[- ]|\bx-|\bburg(er|uer)\b|\bhamburg|\bsmash\b)/, '🍔'],
  [/\bpizzas?\b/, '🍕'],
  [/\bacai\b/, '🍇'],
  [/\b(batatas?|fritas?)\b/, '🍟'],
  [/\bcervejas?\b/, '🍺'],
  [/\bagua\b/, '💧'],
  [/\b(refrigerantes?|refri|coca|guarana|sucos?|fanta|sprite|soda)\b/, '🥤'],
  [/\bbacon\b/, '🥓'],
  [/\b(queijos?|cheddar|mussarela|muçarela)\b/, '🧀'],
  [/\bovos?\b/, '🍳'],
  [/\bcebolas?\b/, '🧅'],
  [/\btomates?\b/, '🍅'],
  [/\b(alface|saladas?)\b/, '🥬'],
  [/\bfrangos?\b/, '🍗'],
  [/\b(carnes?|picanha)\b/, '🥩'],
  [/\bbananas?\b/, '🍌'],
  [/\bmel\b/, '🍯'],
  [/\bmorangos?\b/, '🍓'],
  [/\buvas?\b/, '🍇'],
  [/\bmacas?\b/, '🍎'],
  [/\bperas?\b/, '🍐'],
  [/\blim(ao|oes)\b/, '🍋'],
  [/\bkiwis?\b/, '🥝'],
  [/\bcocos?\b/, '🥥'],
  [/\bleite\b/, '🥛'],
  [/\b(granola|sucrilhos?)\b/, '🥣'],
  [/\b(chocolates?|nutella)\b/, '🍫'],
  [/\b(pacoca|amendoim)\b/, '🥜'],
  [/\bsorvetes?\b/, '🍨'],
]

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Palavras para o emoji com erro de digitação do cadastro (14/10: "Cheedar", "Catupiri", "bacom"). Comparação palavra a
 * palavra, até 1 letra de diferença (2 em palavras de 7+ letras), só para palavras de 5+ letras.
 */
const EMOJIS_APROXIMADOS: [string, string][] = [
  ['cheddar', '🧀'], ['catupiry', '🧀'], ['catupiri', '🧀'], ['requeijao', '🧀'], ['mussarela', '🧀'], ['queijo', '🧀'],
  ['picles', '🥒'], ['pepino', '🥒'], ['bacon', '🥓'], ['cebola', '🧅'], ['tomate', '🍅'], ['alface', '🥬'], ['frango', '🍗'],
  ['calabresa', '🍖'], ['batata', '🍟'], ['banana', '🍌'], ['morango', '🍓'], ['chocolate', '🍫'], ['nutella', '🍫'],
]

function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

export function emojiDoItem(nome: string): string | null {
  const n = normalizar(nome ?? '')
  for (const [re, e] of EMOJIS) if (re.test(n)) return e
  for (const w of n.split(/[^a-z]+/).filter((x) => x.length >= 5)) {
    for (const [alvo, e] of EMOJIS_APROXIMADOS) if (distancia(w, alvo) <= (alvo.length >= 7 ? 2 : 1)) return e
  }
  return null
}

export const brl = (v: number) => `R$ ${Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const maiuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const comEmoji = (nome: string, texto: string) => { const e = emojiDoItem(nome); return e ? `${e} ${texto}` : texto }

/** "🥓 Bacon extra `+R$ 4,00`" — grátis sem preço. */
export function linhaComplemento(nome: string, preco: number): string {
  const n = maiuscula(nome.trim())
  return comEmoji(n, Number(preco) > 0 ? `${n} \`+${brl(Number(preco))}\`` : n)
}

/** "🍇 *1x Açaí grandão* `R$ 32,00`" */
export function linhaItem(quantidade: number, nome: string, preco: number): string {
  return comEmoji(nome, `*${quantidade}x ${nome.trim()}* \`${brl(preco)}\``)
}

/** Lista para escolher: "1. A\n2. B". */
export function listaNumerada(opcoes: string[]): string {
  return opcoes.map((o, i) => `${i + 1}. ${o}`).join('\n')
}

const SEM_NUMERO = /\d/

/**
 * Quebra listas que vieram numa linha só (da IA ou de texto antigo) em uma opção por linha:
 *  - itens separados por " · " (2 ou mais separadores);
 *  - lista curta depois de ": " com vírgulas e "e"/"ou"/"e/ou" (3 ou mais partes de até 4 palavras, sem números).
 * Frases comuns ficam como estão.
 */
export function quebrarListasEmLinha(texto: string): string {
  return (texto ?? '').split('\n').map((linha) => {
    const recuo = /^\s*/.exec(linha)?.[0] ?? ''
    const corpo = linha.slice(recuo.length)
    // "a · b · c" (o resumo antigo vinha em itálico: _a · b · c_)
    const semItalico = corpo.replace(/^_(.*)_$/, '$1')
    const pontos = semItalico.split(/\s+·\s+/)
    if (pontos.length >= 3 || (pontos.length === 2 && pontos.every((p) => p.split(/\s+/).length <= 4))) {
      return pontos.map((p) => recuo + linhaComplemento(p.replace(/[.;]$/, ''), 0)).join('\n')
    }
    const m = /^(.*?:)\s+(.+?)[.!]?$/.exec(corpo)
    if (m && !/\d$/.test(m[1].replace(/:$/, ''))) {
      const partes = m[2].split(/\s*,\s*|\s+e\/ou\s+|\s+ou\s+|\s+e\s+/).map((p) => p.trim()).filter(Boolean)
      if (partes.length >= 3 && partes.every((p) => p.split(/\s+/).length <= 4 && !SEM_NUMERO.test(p))) {
        return [recuo + m[1], ...partes.map((p) => recuo + linhaComplemento(p, 0))].join('\n')
      }
    }
    return linha
  }).join('\n')
}
