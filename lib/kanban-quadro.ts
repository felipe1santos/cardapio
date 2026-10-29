import type { Pedido } from './queries/pedidos'
import { pedidoLiberado } from './agendamento'

/**
 * Quadro do Kanban atualizado pelo pedido que mudou (achado #5 da auditoria, 25/10). Antes, todo evento em `pedidos`
 * relia ativos + logística + todos os concluídos do dia. As regras de cada coluna são as mesmas das consultas de lista:
 * - ativos: `recebido | preparando | pronto` (listarPedidosKanban), menos os agendados ainda fora da janela;
 * - trânsito: entrega `em_rota` (listarPedidosLogistica filtrado como no Kanban);
 * - concluídos: `entregue | cancelado` atualizados desde o início do dia (listarPedidosConcluidos).
 */

export interface Quadro {
  orders: Pedido[]
  agendados: Pedido[]
  transit: Pedido[]
  concluded: Pedido[]
}

export const QUADRO_VAZIO: Quadro = { orders: [], agendados: [], transit: [], concluded: [] }

export interface ContextoQuadro {
  agora: Date
  liberaMin: number
  /** ISO do início do dia: o mesmo corte dos concluídos da lista. */
  inicioDia: string
}

const ATIVOS = new Set(['recebido', 'preparando', 'pronto'])
const CONCLUIDOS = new Set(['entregue', 'cancelado'])

const porCriacao = (a: Pedido, b: Pedido) => a.criadoEm.localeCompare(b.criadoEm)
const porAtualizacaoDesc = (a: Pedido, b: Pedido) => b.atualizadoEm.localeCompare(a.atualizadoEm)
const porAgendamento = (a: Pedido, b: Pedido) => String(a.agendadoPara).localeCompare(String(b.agendadoPara))

type Coluna = keyof Quadro | null

function colunaDe(p: Pedido, ctx: ContextoQuadro): Coluna {
  if (ATIVOS.has(p.status)) {
    return p.status === 'recebido' && !pedidoLiberado(p.agendadoPara, ctx.liberaMin, ctx.agora) ? 'agendados' : 'orders'
  }
  if (p.status === 'em_rota') return p.tipo === 'entrega' ? 'transit' : null
  if (CONCLUIDOS.has(p.status)) return Date.parse(p.atualizadoEm) >= Date.parse(ctx.inicioDia) ? 'concluded' : null
  return null
}

/** Encaixa os pedidos que mudaram (e tira os removidos) sem reler as listas. */
export function aplicarNoQuadro(q: Quadro, alterados: Pedido[], removidos: string[], ctx: ContextoQuadro): Quadro {
  const destino = new Map(alterados.map((p) => [p.id, { p, col: colunaDe(p, ctx) }]))
  const tirar = new Set(removidos)
  const colunas = ['orders', 'agendados', 'transit', 'concluded'] as const
  const novo = { ...QUADRO_VAZIO } as Quadro
  for (const col of colunas) {
    // Na mesma coluna, troca no lugar: com horários empatados, o card não pula de posição.
    novo[col] = q[col].flatMap((p) => {
      if (tirar.has(p.id)) return []
      const d = destino.get(p.id)
      if (!d) return [p]
      if (d.col !== col) return []
      destino.delete(p.id)
      return [d.p]
    })
  }
  for (const { p, col } of destino.values()) if (col) novo[col].push(p)
  novo.orders.sort(porCriacao)
  novo.transit.sort(porCriacao)
  novo.concluded.sort(porAtualizacaoDesc)
  novo.agendados.sort(porAgendamento)
  return novo
}

/** Concluídos que mudaram desde a última leitura (relógio do Kanban) juntados aos que já estão na tela. */
export function mesclarConcluidos(atual: Pedido[], delta: Pedido[], inicioDia: string, idsAtivos: Set<string> = new Set()): Pedido[] {
  const porId = new Map(atual.map((p) => [p.id, p]))
  for (const p of delta) porId.set(p.id, p)
  const corte = Date.parse(inicioDia)
  // Pedido que voltou para os ativos (ex.: "Não entregue") sai daqui — o delta só traz quem ainda está concluído.
  return [...porId.values()].filter((p) => Date.parse(p.atualizadoEm) >= corte && !idsAtivos.has(p.id)).sort(porAtualizacaoDesc)
}

/** Pedido novo que chegou sem itens (os itens gravam logo depois do pedido): vale buscar de novo em instantes. */
export function novosSemItens(pedidos: Pedido[]): string[] {
  return pedidos.filter((p) => p.status === 'recebido' && p.itens.length === 0).map((p) => p.id)
}

/** Id que um evento do Realtime alterou ou removeu. */
export function idsDoEvento(payload: { eventType?: string; new?: unknown; old?: unknown }): { alterado?: string; removido?: string } {
  const novo = payload.new as { id?: unknown } | null | undefined
  const velho = payload.old as { id?: unknown } | null | undefined
  if (payload.eventType === 'DELETE') return typeof velho?.id === 'string' ? { removido: velho.id } : {}
  return typeof novo?.id === 'string' ? { alterado: novo.id } : {}
}

/**
 * Fila do Kanban: um trabalho de cada vez, para uma resposta antiga nunca sobrescrever uma nova. Recarga COMPLETA
 * pedida enquanto outra ainda espera a vez é a mesma recarga (medido em produção, 26/10: abrir a tela fazia 4 recargas
 * completas no mesmo segundo — carga inicial + sincronização de cada canal). Pedida depois que a anterior começou, roda
 * de novo: algo pode ter mudado no meio.
 */
export function criarFila() {
  let cauda: Promise<void> = Promise.resolve()
  let completoEsperando: Promise<void> | null = null
  const rodar = (trabalho: () => Promise<void>) => {
    const p = cauda.then(trabalho, trabalho)
    cauda = p.catch(() => {})
    return p
  }
  return {
    rodar,
    rodarCompleto(trabalho: () => Promise<void>) {
      if (completoEsperando) return completoEsperando
      const p = rodar(async () => { completoEsperando = null; await trabalho() })
      completoEsperando = p
      return p
    },
  }
}

export interface LoteEventos {
  alterados: Set<string>
  removidos: Set<string>
  /** Muitos pedidos de uma vez: mais barato reler as listas. */
  completo: boolean
  corridas: boolean
  solicitacoes: boolean
}

/**
 * Junta os eventos que chegam numa janela curta numa busca só. A janela conta do PRIMEIRO evento (não é reiniciada a
 * cada evento), então uma sequência contínua não adia a atualização da tela.
 */
export function criarColetorEventos({ esperaMs, maxIds, descarregar }: { esperaMs: number; maxIds: number; descarregar: (lote: LoteEventos) => void }) {
  let lote: LoteEventos | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const atual = () => {
    if (!lote) lote = { alterados: new Set(), removidos: new Set(), completo: false, corridas: false, solicitacoes: false }
    if (!timer) {
      timer = setTimeout(() => {
        const l = lote!
        lote = null
        timer = null
        if (l.alterados.size + l.removidos.size > maxIds) l.completo = true
        descarregar(l)
      }, esperaMs)
    }
    return lote
  }
  return {
    pedido(ev: { alterado?: string; removido?: string }) {
      const l = atual()
      if (ev.alterado) { l.alterados.add(ev.alterado); l.removidos.delete(ev.alterado) }
      if (ev.removido) { l.removidos.add(ev.removido); l.alterados.delete(ev.removido) }
      if (!ev.alterado && !ev.removido) l.completo = true
    },
    tabela(t: 'entregas_provedor' | 'pedido_solicitacoes') {
      const l = atual()
      if (t === 'entregas_provedor') l.corridas = true
      else l.solicitacoes = true
    },
    cancelar() {
      if (timer) clearTimeout(timer)
      timer = null
      lote = null
    },
  }
}

/** Heartbeat do Kanban: roda com a aba visível ou, escondida, só se o aceite automático (feito no navegador) estiver ligado. */
export function heartbeatDoKanbanRoda(visivel: boolean, aceiteAutomatico: boolean): boolean {
  return visivel || aceiteAutomatico
}
