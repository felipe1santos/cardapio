/**
 * Regras das opções de um item (grupos de complementos) — puras, sem banco.
 *
 * Existe porque `criarPedido` confia que as escolhas chegam válidas: ele reprecifica
 * cada complemento pelo nome, mas não confere se o grupo obrigatório foi respondido.
 * Na vitrine a própria ficha impede avançar; no painel do garçom quem garante é o
 * servidor, com esta função — senão a cozinha recebe um burger sem ponto.
 */

export interface GrupoOpcoesRegra {
  nome: string
  obrigatorio: boolean
  minEscolhas: number
  maxEscolhas: number
  /** Nomes das opções disponíveis (complementos não pausados). */
  opcoes: string[]
}

/** Quantas escolhas o grupo exige de verdade. Obrigatório sem mínimo vale 1. */
export function minimoDoGrupo(g: Pick<GrupoOpcoesRegra, 'obrigatorio' | 'minEscolhas'>): number {
  if (!g.obrigatorio) return 0
  return Math.max(1, g.minEscolhas)
}

/** Máximo sensato: nunca abaixo de 1, nunca acima do número de opções. */
export function maximoDoGrupo(g: Pick<GrupoOpcoesRegra, 'maxEscolhas' | 'opcoes'>): number {
  return Math.max(1, Math.min(g.maxEscolhas || 1, g.opcoes.length || 1))
}

/**
 * Confere as escolhas de UM item contra os grupos dele.
 *
 * Devolve as mensagens de erro (vazio = válido). Uma escolha só conta para o grupo a que
 * pertence: escolher "Bacon" não responde "Escolha o ponto".
 */
export function validarOpcoes(grupos: GrupoOpcoesRegra[], escolhidas: string[]): string[] {
  const erros: string[] = []
  const conjunto = new Set(escolhidas)

  for (const g of grupos) {
    if (g.opcoes.length === 0) continue
    const doGrupo = g.opcoes.filter((o) => conjunto.has(o)).length
    const min = minimoDoGrupo(g)
    const max = maximoDoGrupo(g)

    if (doGrupo < min) {
      erros.push(min === 1 ? `Escolha uma opção em "${g.nome}".` : `Escolha ${min} opções em "${g.nome}".`)
    } else if (doGrupo > max) {
      erros.push(`"${g.nome}" aceita no máximo ${max} ${max === 1 ? 'opção' : 'opções'}.`)
    }
  }

  // Nome que não existe em nenhum grupo: opção pausada, removida ou inventada.
  const conhecidas = new Set(grupos.flatMap((g) => g.opcoes))
  for (const e of escolhidas) {
    if (!conhecidas.has(e)) erros.push(`A opção "${e}" não está disponível.`)
  }

  return erros
}
