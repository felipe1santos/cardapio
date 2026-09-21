/**
 * Marcação leve da descrição do item — negrito e cor, escolhidos pelo lojista.
 *
 * Por que uma marcação própria e não HTML: a descrição é texto que o lojista
 * digita e que a vitrine mostra para qualquer visitante. Aceitar HTML seria
 * abrir um caminho de XSS que teria de ser sanitizado a cada exibição (vitrine,
 * cardápio da mesa, recibo, WhatsApp). Aqui o texto continua sendo texto: o
 * parser devolve PEDAÇOS, e quem desenha decide como. Nada do que o lojista
 * escreve vira marcação sem passar por esta allowlist.
 *
 * A sintaxe é a menor possível, porque quem escreve é dono de restaurante no
 * celular, não programador — e a barra de ferramentas do cadastro insere tudo:
 *
 *   **texto**              → negrito
 *   [[roxo]]texto[[/]]     → colorido (só as cores desta paleta)
 *   [[roxo|b]]texto[[/]]   → colorido e negrito
 *
 * Fora disso, tudo é texto literal: um `**` solto, um colchete perdido ou uma
 * cor que não existe aparecem como o lojista escreveu, sem sumir da tela.
 */

/** Cores que o lojista pode usar. Fechada de propósito: nome → valor. */
export const CORES_DESCRICAO = [
  { id: 'vermelho', label: 'Vermelho', valor: '#DC2626' },
  { id: 'laranja', label: 'Laranja', valor: '#EA580C' },
  { id: 'verde', label: 'Verde', valor: '#15803D' },
  { id: 'azul', label: 'Azul', valor: '#1D4ED8' },
  { id: 'roxo', label: 'Roxo', valor: '#7C3AED' },
  { id: 'rosa', label: 'Rosa', valor: '#BE185D' },
  { id: 'cinza', label: 'Cinza', valor: '#4B5563' },
] as const

export type CorDescricao = (typeof CORES_DESCRICAO)[number]['id']

const VALOR_DA_COR = new Map<string, string>(CORES_DESCRICAO.map((c) => [c.id, c.valor]))

export interface PedacoDescricao {
  texto: string
  negrito: boolean
  /** Valor CSS da cor, ou `null` para a cor padrão do contexto. */
  cor: string | null
}

/** Abertura de cor: `[[roxo]]` ou `[[roxo|b]]`. */
const ABRE_COR = /^\[\[([a-z]+)(\|b)?\]\]/
const FECHA_COR = '[[/]]'

/**
 * Posição do `[[/]]` que fecha a cor aberta em `desde`, pulando os pares
 * internos. Um regex não-guloso fecharia no primeiro `[[/]]` que encontrasse e,
 * em `[[verde]]a [[roxo]]b[[/]][[/]]`, deixaria um `[[/]]` solto na tela do
 * cliente. `-1` quando ninguém fecha — aí o trecho é texto literal.
 */
function fimDoTrechoColorido(texto: string, desde: number): number {
  let nivel = 1
  let i = desde
  while (i < texto.length) {
    if (texto.startsWith(FECHA_COR, i)) {
      nivel--
      if (nivel === 0) return i
      i += FECHA_COR.length
      continue
    }
    const abertura = ABRE_COR.exec(texto.slice(i))
    if (abertura) {
      nivel++
      i += abertura[0].length
      continue
    }
    i++
  }
  return -1
}

/**
 * Quebra a descrição nos pedaços que a tela desenha. Texto sem marcação nenhuma
 * devolve um pedaço só — o caso de quase todo item, e o mais barato.
 *
 * Marcação dentro de marcação é lida: `**[[roxo]]x[[/]]**` sai roxo E negrito.
 * Isso não é firula — é o que acontece quando o lojista seleciona um trecho já
 * destacado e clica no outro botão, e sem a recursão os colchetes apareciam
 * crus no cardápio. `profundidade` corta o caso patológico de texto colado com
 * dezenas de níveis, em vez de deixar a página do cliente rodando à toa.
 */
export function pedacosDaDescricao(bruto: string | null | undefined, profundidade = 0): PedacoDescricao[] {
  const texto = bruto ?? ''
  if (!texto) return []
  if (profundidade > 4) return [{ texto, negrito: false, cor: null }]

  const pedacos: PedacoDescricao[] = []
  let literalDesde = 0
  let i = 0

  const fecharLiteral = (ate: number) => {
    if (ate > literalDesde) pedacos.push({ texto: texto.slice(literalDesde, ate), negrito: false, cor: null })
  }
  const herdar = (dentro: string, negrito: boolean, cor: string | null) => {
    for (const p of pedacosDaDescricao(dentro, profundidade + 1)) {
      pedacos.push({ texto: p.texto, negrito: p.negrito || negrito, cor: p.cor ?? cor })
    }
  }

  while (i < texto.length) {
    if (texto.startsWith('**', i)) {
      const fim = texto.indexOf('**', i + 2)
      // `**` sem par, ou `****` vazio: é texto, não marcação.
      if (fim > i + 2) {
        fecharLiteral(i)
        herdar(texto.slice(i + 2, fim), true, null)
        i = fim + 2
        literalDesde = i
        continue
      }
    }

    const abertura = ABRE_COR.exec(texto.slice(i))
    // Cor fora da paleta não vira marcação: o trecho fica literal, como escrito.
    if (abertura && VALOR_DA_COR.has(abertura[1]!)) {
      const inicioConteudo = i + abertura[0].length
      const fim = fimDoTrechoColorido(texto, inicioConteudo)
      if (fim !== -1) {
        fecharLiteral(i)
        herdar(texto.slice(inicioConteudo, fim), abertura[2] !== undefined, VALOR_DA_COR.get(abertura[1]!)!)
        i = fim + FECHA_COR.length
        literalDesde = i
        continue
      }
    }

    i++
  }

  fecharLiteral(texto.length)
  return pedacos.filter((p) => p.texto !== '')
}

/** True quando há alguma marcação válida — a tela só monta pedaços se precisar. */
export function temFormatacao(bruto: string | null | undefined): boolean {
  const pedacos = pedacosDaDescricao(bruto)
  return pedacos.some((p) => p.negrito || p.cor !== null)
}

/**
 * Texto puro, sem marcação nenhuma. É o que vai para onde formatação não existe:
 * recibo impresso, mensagem de WhatsApp, `alt` de imagem, busca e metadados.
 */
export function descricaoEmTextoPuro(bruto: string | null | undefined): string {
  return pedacosDaDescricao(bruto)
    .map((p) => p.texto)
    .join('')
}

/**
 * Envolve o trecho selecionado com a marcação pedida, para a barra do cadastro.
 * Sem seleção, devolve o texto intacto e a mesma posição — nada de inserir
 * marcadores vazios que o lojista depois teria de caçar e apagar.
 */
export function aplicarMarcacao(
  texto: string,
  inicio: number,
  fim: number,
  marca: { tipo: 'negrito' } | { tipo: 'cor'; cor: CorDescricao; negrito?: boolean },
): { texto: string; selecao: [number, number] } {
  if (inicio >= fim) return { texto, selecao: [inicio, fim] }
  const selecionado = texto.slice(inicio, fim)

  // Já marcado do mesmo jeito? Tira, em vez de empilhar. É o que o botão de
  // negrito faz em qualquer editor, e evita `**[[roxo]]x[[/]]**` crescendo a
  // cada clique de quem só queria corrigir o destaque.
  let envolvido: string
  if (marca.tipo === 'negrito') {
    envolvido =
      selecionado.startsWith('**') && selecionado.endsWith('**') && selecionado.length > 4
        ? selecionado.slice(2, -2)
        : `**${selecionado}**`
  } else {
    const jaColorido = /^\[\[[a-z]+(\|b)?\]\][\s\S]*\[\[\/\]\]$/.test(selecionado)
    const nu = jaColorido ? selecionado.replace(/^\[\[[a-z]+(\|b)?\]\]/, '').replace(/\[\[\/\]\]$/, '') : selecionado
    envolvido = `[[${marca.cor}${marca.negrito ? '|b' : ''}]]${nu}[[/]]`
  }

  return {
    texto: texto.slice(0, inicio) + envolvido + texto.slice(fim),
    selecao: [inicio, inicio + envolvido.length],
  }
}
