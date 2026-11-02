/**
 * Por que um item "Disponível" NÃO está na vitrine agora (02/11/2026).
 *
 * Caso real: a Ferraz Burguer abre dom/qui/sex/sáb e marcou nos itens exatamente esses
 * dias. Numa segunda, o Gestor mostrava 8 itens "Disponível" e a vitrine ficava vazia —
 * a categoria some junto quando não sobra item. O lojista achou que era bug no cadastro.
 *
 * A vitrine (`listarCardapioPublico`) esconde item sem categoria, só do salão, fora dos
 * dias marcados e de categoria fora do horário. Aqui é o MESMO critério, pelas mesmas
 * funções, só que respondendo "por quê" para o Gestor mostrar ao lado do badge. Nada
 * disto muda o que a vitrine mostra ou vende.
 *
 * Um motivo por vez, na ordem em que o lojista corrige: categoria → canal → dias → horário.
 * Pausado/esgotado não entra: o badge já explica.
 */
import { itemDisponivelNoCanal } from './canais-item'
import { diaSemanaSaoPaulo, grupoEstaAtivoAgora, itemDisponivelHoje } from './timezone'

export interface ItemParaVisibilidade {
  status: string
  grupoId: string | null
  diasDisponiveis: number[]
  disponivelDelivery: boolean
  disponivelSalao: boolean
}

export interface GrupoParaVisibilidade {
  horarioAtivoInicio: string | null
  horarioAtivoFim: string | null
}

const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const DIA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function listarDias(dias: number[]): string {
  const nomes = [...dias].sort((a, b) => a - b).map((d) => DIA_CURTO[d]).filter(Boolean)
  if (nomes.length <= 1) return nomes.join('')
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

/**
 * `null` = o item está (ou estaria) na vitrine agora. String = o motivo, pronto para a tela.
 * `grupo` é a categoria do item (`undefined` quando ele não tem ou ela não existe mais).
 */
export function motivoForaDaVitrine(
  item: ItemParaVisibilidade,
  grupo: GrupoParaVisibilidade | null | undefined,
  agora: Date = new Date(),
): string | null {
  if (item.status !== 'disponivel') return null
  if (!item.grupoId || !grupo) return 'Sem categoria: não aparece na vitrine.'
  if (!itemDisponivelNoCanal(item, 'delivery')) return 'Só no salão: não aparece na vitrine.'
  const dias = item.diasDisponiveis ?? []
  if (dias.length === 0) return 'Nenhum dia marcado: não aparece na vitrine.'
  if (!itemDisponivelHoje(dias, agora)) {
    return `Hoje (${DIA_LONGO[diaSemanaSaoPaulo(agora.toISOString())]}) não aparece na vitrine: só ${listarDias(dias)}.`
  }
  if (!grupoEstaAtivoAgora(grupo, agora)) {
    return `Categoria fora do horário agora (${grupo.horarioAtivoInicio}–${grupo.horarioAtivoFim}): não aparece na vitrine.`
  }
  return null
}
