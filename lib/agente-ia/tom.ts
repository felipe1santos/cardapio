/**
 * Agente de IA — tom das mensagens (12/10, pedido do dono): humano, curto (1 a 3 linhas), uma pergunta por vez, no máximo
 * 1 emoji, sem títulos em negrito/maiúsculas e sem listas — só o resumo do pedido (texto do servidor) usa esse formato.
 * `problemasDeTom` é a régua dos testes (e da avaliação com a API real); `limparTom` tira cabeçalho e marcador de lista
 * que escaparem, sem mudar o conteúdo.
 */
export type ProblemaTom = 'longa' | 'cabecalho' | 'lista' | 'emojis' | 'exemplo_de_pedido' | 'duas_perguntas'

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
  // 12/10: lista de OPÇÕES (uma por linha, numerada para escolher) é a regra; lista de PERGUNTAS continua proibida.
  if (linhas.filter((l) => /^\s*([-•*]|\d+[.)])\s+.*\?\s*$/.test(l)).length >= 2) p.push('lista')
  // No máximo 1 emoji por LINHA (antes: por mensagem; as listas levam o emoji de cada item).
  if (linhas.some((l) => (l.match(EMOJI) ?? []).length > 1)) p.push('emojis')
  if (opcoes.entrada && EXEMPLO_PEDIDO.test(texto)) p.push('exemplo_de_pedido')
  if ((texto.match(/\?/g) ?? []).length >= 2) p.push('duas_perguntas')
  return p
}

/** Frase depois da 1ª pergunta que é outra pergunta ("E a forma de pagamento?", "me diz o endereço", "Também me fala…"). */
const OUTRA_PERGUNTA = /\?|\b(diz|diga|fala|fale|passa|passe|manda|mande|conta|conte|informa|informe)\b|^\s*tamb[ée]m\b/i

/** Uma pergunta por mensagem (12/10, teste 19:36): o que vier depois da 1ª e for outra pergunta sai. */
export function umaPergunta(texto: string): string {
  const i = texto.indexOf('?')
  if (i < 0) return texto
  const frases = texto.slice(i + 1).match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? []
  let fica = ''
  for (const f of frases) {
    if (f.trim() && OUTRA_PERGUNTA.test(f)) break
    fica += f
  }
  return (texto.slice(0, i + 1) + fica).replace(/\n{3,}/g, '\n\n').trim()
}

/** Tira linhas que são só cabeçalho e os marcadores de lista ("- "), mantendo o texto; uma pergunta só. */
export function limparTom(texto: string): string {
  return umaPergunta(texto
    .split('\n')
    .filter((l) => !CABECALHO.test(l))
    // Tira "- " e "• "; o número fica nas opções (para o cliente responder o número) e sai só de pergunta numerada.
    .map((l) => l.replace(/^\s*[-•]\s+/, '').replace(/^\s*\d+[.)]\s+(?=.*\?\s*$)/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim())
}
