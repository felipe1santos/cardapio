import { pedacosDaDescricao, type PedacoDescricao } from '@/lib/descricao-rica'

/**
 * Nome de item na vitrine do cliente.
 *
 * O nome aceita a mesma marcação leve da descrição (`**negrito**`,
 * `[[vermelho]]cor[[/]]`) — o lojista colou ou digitou e ela foi gravada assim.
 * A descrição é desenhada pelo parser, mas o nome ia cru para a tela, e o
 * cliente via `Bolo **[[vermelho]]Duplo[[/]]** Recheio` no card, na sacola e no
 * histórico.
 *
 * Aqui a regra é mais dura que a da descrição: no nome, marcador que sobrou sem
 * par (um `**` solto, um `[[/]]` perdido) também sai. Na descrição ele fica
 * literal para o lojista notar; no nome ele só polui a tela do cliente.
 *
 * Só para EXIBIÇÃO. O dado gravado não muda, e o pedido continua indo pelo
 * `itemId`, então nada de pedido/recibo depende disto.
 */

/** Marcadores que não formaram par e ficaram no texto. */
const MARCADOR_SOLTO = /\*\*|\[\[[a-z]*(?:\|b)?\]\]|\[\[\/\]\]/g

function semMarcadorSolto(texto: string): string {
  return texto.replace(MARCADOR_SOLTO, '')
}

/** Pedaços do nome para desenhar com cor/negrito, já sem marcador solto. */
export function pedacosDoNome(bruto: string | null | undefined): PedacoDescricao[] {
  const pedacos = pedacosDaDescricao(bruto)
    .map((p) => ({ ...p, texto: semMarcadorSolto(p.texto) }))
    .filter((p) => p.texto !== '')
  // Espaço duplo onde um marcador vazio saiu ("Bolo ** Duplo") e borda limpa.
  const n = pedacos.length
  return pedacos
    .map((p, i) => {
      let t = p.texto.replace(/\s{2,}/g, ' ')
      if (i === 0) t = t.trimStart()
      if (i === n - 1) t = t.trimEnd()
      return { ...p, texto: t }
    })
    .filter((p) => p.texto !== '')
}

/** Nome em texto limpo: sacola, checkout, histórico, busca, `alt`, avisos. */
export function nomeLimpo(bruto: string | null | undefined): string {
  return pedacosDoNome(bruto)
    .map((p) => p.texto)
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** True quando o nome tem cor ou negrito para desenhar. */
export function nomeTemFormatacao(bruto: string | null | undefined): boolean {
  return pedacosDoNome(bruto).some((p) => p.negrito || p.cor !== null)
}
