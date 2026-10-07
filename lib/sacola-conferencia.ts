/**
 * Conferência da sacola guardada no aparelho (vitrine). Regras puras, testadas: o motivo que o
 * servidor deu vira um texto curto para a linha e um texto simples para o "Continuar" bloqueado.
 */
export type TipoIndisponivel = 'indisponivel' | 'fora_do_dia' | 'fora_do_horario' | 'removido' | 'opcao' | 'canal' | 'outro'

export interface ConferenciaLinha {
  chave: string
  ok: boolean
  tipo?: TipoIndisponivel
  /** Explicação em linguagem simples, para o cliente. */
  motivo?: string
  precoAtual?: number
  /** Presente quando o preço mudou desde que o item foi para a sacola. */
  precoAnterior?: number
}

export function classificarIndisponivel(mensagem: string, agendado: boolean): { tipo: TipoIndisponivel; motivo: string } {
  const m = mensagem
  if (/não encontrado nesta loja/i.test(m)) return { tipo: 'removido', motivo: 'Este item não existe mais no cardápio.' }
  if (/no dia agendado/i.test(m)) return { tipo: 'fora_do_dia', motivo: 'Não é vendido no dia agendado.' }
  if (/disponível hoje/i.test(m)) return { tipo: 'fora_do_dia', motivo: agendado ? 'Não é vendido no dia agendado.' : 'Não é vendido hoje.' }
  if (/em outro horário/i.test(m)) return { tipo: 'fora_do_horario', motivo: agendado ? 'Não é vendido no horário agendado.' : 'Só é vendido em outro horário.' }
  if (/a opção .* não está disponível/i.test(m) || /: (escolha|selecione|no máximo|no mínimo)/i.test(m)) return { tipo: 'opcao', motivo: 'Uma opção escolhida não está mais disponível. Remova e monte de novo.' }
  if (/não está disponível/i.test(m)) return { tipo: 'indisponivel', motivo: 'Indisponível no momento.' }
  if (/neste canal/i.test(m)) return { tipo: 'canal', motivo: 'Não é vendido pelo cardápio digital.' }
  return { tipo: 'outro', motivo: 'Não pode ser pedido agora. Remova e escolha de novo.' }
}

/** Texto do "Continuar" bloqueado: quantos itens e o que fazer. */
export function motivoBloqueioSacola(indisponiveis: number): string | null {
  if (indisponiveis <= 0) return null
  return indisponiveis === 1
    ? 'Um item da sacola está indisponível. Remova para continuar.'
    : `${indisponiveis} itens da sacola estão indisponíveis. Remova para continuar.`
}
