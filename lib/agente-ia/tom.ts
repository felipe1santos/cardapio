/**
 * Agente de IA — tom das mensagens (12/10, pedido do dono): humano, curto (1 a 3 linhas), uma pergunta por vez, no máximo
 * 1 emoji, sem títulos em negrito/maiúsculas e sem listas — só o resumo do pedido (texto do servidor) usa esse formato.
 * `problemasDeTom` é a régua dos testes (e da avaliação com a API real); `limparTom` tira cabeçalho e marcador de lista
 * que escaparem, sem mudar o conteúdo.
 */
export type ProblemaTom = 'longa' | 'cabecalho' | 'lista' | 'emojis' | 'exemplo_de_pedido'

export const MAX_CARACTERES_IA = 400

const CABECALHO = /^\s*\*[^*\n]{2,60}\*:?\s*$/
const EMOJI = /\p{Extended_Pictographic}/gu
/** Entrada no pedido dando exemplo ("ex.: 1 Hamburguer Supremo", "nome do lanche, pizza ou bebida e a quantidade"). */
const EXEMPLO_PEDIDO = /\b(ex\.?|exemplo|tipo)\s*:?\s*\(?\s*\d+\s*x?\s*\p{L}|\(\s*\d+\s*x?\s+\p{Lu}|nome do lanche|lanche, pizza ou bebida|pizza, lanche ou bebida/iu

export function problemasDeTom(texto: string, opcoes: { entrada?: boolean } = {}): ProblemaTom[] {
  const p: ProblemaTom[] = []
  const linhas = texto.split('\n')
  if (texto.length > MAX_CARACTERES_IA) p.push('longa')
  if (linhas.some((l) => CABECALHO.test(l))) p.push('cabecalho')
  if (linhas.filter((l) => /^\s*([-•*]|\d+[.)])\s+\S/.test(l)).length >= 2) p.push('lista')
  if ((texto.match(EMOJI) ?? []).length > 1) p.push('emojis')
  if (opcoes.entrada && EXEMPLO_PEDIDO.test(texto)) p.push('exemplo_de_pedido')
  return p
}

/** Tira linhas que são só cabeçalho e os marcadores de lista ("- "), mantendo o texto. */
export function limparTom(texto: string): string {
  return texto
    .split('\n')
    .filter((l) => !CABECALHO.test(l))
    .map((l) => l.replace(/^\s*([-•]|\d+[.)])\s+/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
