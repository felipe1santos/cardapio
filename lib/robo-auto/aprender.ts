/**
 * "Perguntas que o robô não entendeu" (16/10/2026) — regras puras do ensino: o dono revisa uma frase por vez e escolhe
 * robô responde (1–3 palavras viram palavra-chave do assunto) · IA responde (conhecimento da loja) · é pedido · ignorar.
 * A sugestão automática vem daqui (sem custo); a IA só completa em lote, 1x/dia, com o módulo ligado.
 */
import { ASSUNTOS, classificar, normalizarTexto, PALAVRAS_PADRAO, type Assunto, type PalavrasExtras } from './classificador'

export type AcaoAprender = 'robo' | 'ia' | 'pedido' | 'ignorar'
export interface Sugestao { acao: AcaoAprender; assunto?: Assunto; palavras?: string[]; fonte: 'regras' | 'ia' }

/** Palavras que não dizem o assunto (não aparecem como botão nem viram palavra-chave). */
const VAZIAS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'e', 'que', 'pra', 'pro', 'para', 'por', 'com', 'no', 'na', 'nos',
  'nas', 'em', 'me', 'te', 'se', 'eu', 'voce', 'voces', 'ta', 'tao', 'to', 'tem', 'ai', 'aqui', 'la', 'isso', 'esse', 'essa', 'ja', 'so', 'mais',
  'muito', 'bem', 'sim', 'nao', 'ou', 'mas', 'ne', 'tipo', 'esta', 'estao', 'sao', 'foi', 'vai', 'ser', 'ter', 'meu', 'minha', 'seu', 'sua',
])

/** Frases inteiras que só preenchem a conversa: sugestão "ignorar". */
const IGNORAR = new Set(['ah', 'aham', 'hum', 'hm', 'humm', 'kk', 'kkk', 'rs', 'rsrs', 'pode deixar', 'hoje', 'ok', 'blz', 'beleza', 'ta bom', 'tudo certo', 'certo', 'opa', 'uai', 'eita', 'nossa'])

export function palavrasDaFrase(texto: string): string[] {
  const vistas = new Set<string>()
  for (const p of normalizarTexto(texto).split(' ')) if (p.length >= 2 && !VAZIAS.has(p) && !/^\d+$/.test(p)) vistas.add(p)
  return [...vistas]
}

/** O robô já entende a frase (com as palavras da loja e as globais)? Sai da lista ao reprocessar. */
export function jaEntende(texto: string, extras?: PalavrasExtras): boolean {
  return classificar(texto, extras).intencao !== 'outro'
}

function distancia(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let ant = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const g = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, ant + (a[i - 1] === b[j - 1] ? 0 : 1))
      ant = g
    }
  }
  return dp[b.length]
}

/** Sugestão sem custo: ignorar o que só preenche; pedido escrito; erro de digitação perto de uma palavra do robô; senão IA. */
export function sugestaoPorRegras(texto: string, extras?: PalavrasExtras): Sugestao {
  const n = normalizarTexto(texto)
  const palavras = n.split(' ').filter(Boolean)
  if (!n || IGNORAR.has(n) || (palavras.length === 1 && palavras[0].length <= 3) || /^(k|ha|rs)+$/.test(n.replace(/ /g, ''))) return { acao: 'ignorar', fonte: 'regras' }
  const c = classificar(texto, extras)
  if (c.intencao === 'pedir') return { acao: 'pedido', fonte: 'regras' }
  if (c.intencao === 'ok') return { acao: 'ignorar', fonte: 'regras' }
  if ((ASSUNTOS as string[]).includes(c.intencao)) return { acao: 'robo', assunto: c.intencao as Assunto, palavras: palavrasDaFrase(texto).slice(0, 2), fonte: 'regras' }
  for (const p of palavrasDaFrase(texto)) {
    if (p.length < 5) continue
    const tol = p.length >= 8 ? 2 : 1
    for (const a of ASSUNTOS) {
      const lista = [...PALAVRAS_PADRAO[a], ...(extras?.[a] ?? [])].filter((k) => !k.includes(' ') && k.length >= 5)
      if (lista.some((k) => distancia(p, k) <= tol)) return { acao: 'robo', assunto: a, palavras: [p], fonte: 'regras' }
    }
  }
  return { acao: 'ia', fonte: 'regras' }
}

/** Antes de salvar: outras frases da lista que a palavra também pega, e assuntos que já usam a palavra. */
export function conflitosDaPalavra(palavra: string, assunto: Assunto, outrasFrases: string[], extras?: PalavrasExtras): { frases: string[]; outrosAssuntos: Assunto[] } {
  const p = normalizarTexto(palavra)
  const tokens = p.split(' ')
  const contem = (t: string) => {
    const w = normalizarTexto(t).split(' ')
    for (let i = 0; i + tokens.length <= w.length; i++) if (tokens.every((x, k) => w[i + k] === x)) return true
    return false
  }
  const outrosAssuntos = ASSUNTOS.filter((a) => a !== assunto && [...PALAVRAS_PADRAO[a], ...(extras?.[a] ?? [])].some((k) => normalizarTexto(k) === p))
  return { frases: outrasFrases.filter(contem), outrosAssuntos }
}

/** Nome de produto ou de bairro da loja: a palavra fica só na loja (não vira sugestão global). */
export function palavraEhDaLoja(palavra: string, nomesItens: string[], bairros: string[]): boolean {
  const p = normalizarTexto(palavra)
  if (!p) return false
  return [...nomesItens, ...bairros].some((nome) => {
    const n = normalizarTexto(nome)
    return n.split(' ').includes(p) || n.replace(/ /g, '').includes(p.replace(/ /g, ''))
  })
}
