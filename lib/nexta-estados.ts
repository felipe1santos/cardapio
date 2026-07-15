/**
 * Máquina de estados da integração: evento do Nexta → `nexta_entregas` → `pedidos.status`.
 *
 * Ponto único usado pelo webhook e pela reconciliação manual. SERVER-ONLY (service_role).
 *
 * Três invariantes que valem para tudo aqui:
 *  1. **Idempotência.** Eventos de movimento (PICKUP_ONGOING, DELIVERY_ONGOING...) repetem
 *     periodicamente com geolocalização nova, e um webhook pode chegar duas vezes. Repetir
 *     um evento atualiza os dados espelhados, mas nunca re-executa a transição do pedido.
 *  2. **Não rebaixar o pedido.** Toda transição é um UPDATE condicional ao status anterior
 *     esperado — um webhook atrasado não pode ressuscitar um pedido já entregue.
 *  3. **Tolerar enum novo.** A spec permite eventos novos sem major version. O que não
 *     conhecemos é registrado no histórico e ignorado, nunca quebra.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NEXTA_EVENTOS_REPETIDOS, nextaEntregaAtiva } from '@/lib/nexta-eventos'
import { aplicarEfeitosStatusPedido } from '@/lib/pedido-eventos'
import {
  atualizarNextaEntrega,
  desvincularEntregaDoPedido,
  registrarEventoNextaEntrega,
  type NextaEntregaLinha,
  type NextaEntregaPatch,
} from '@/lib/queries/nexta'
import type { StatusPedido } from '@/lib/queries/pedidos'

/** Corpo `DeliveryOrderEvent` do Open Delivery, na forma tolerante que o Nexta manda. */
export interface EventoNexta {
  deliveryId?: string
  orderId?: string
  event?: { type?: string; message?: string; datetime?: string; rejectionInfo?: { reason?: string } }
  problem?: unknown[]
  deliveryPrice?: { price?: { value?: number } }
  eta?: { pickupEtaDatetime?: string; deliveryEtaDatetime?: string }
  deliveryPerson?: { name?: string; phone?: string; pictureURL?: string }
  externalTrackingURL?: string
}

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const numero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * Datetime aceito só se for mesmo uma data ISO. Exigir o formato antes de `new Date()`
 * não é preciosismo: o Nexta manda `0` neste campo quando não há ETA, e `new Date('0')`
 * devolve o ano 2000 em vez de NaN — a checagem ingênua gravaria uma ETA-lixo.
 */
const ISO_DATA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

function dataOuNull(v: unknown): string | undefined {
  const s = texto(v)
  if (!s || !ISO_DATA.test(s)) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/**
 * Transição do pedido disparada por cada evento. `de` é a lista de status a partir dos
 * quais a mudança é permitida — fora deles o evento não mexe no pedido (invariante 2).
 */
const TRANSICAO_PEDIDO: Record<string, { de: StatusPedido[]; para: StatusPedido }> = {
  // Coletado = saiu para entrega. É aqui que o cliente recebe o "saiu para entrega".
  ORDER_PICKED: { de: ['pronto'], para: 'em_rota' },
  ORDER_DELIVERED: { de: ['pronto', 'em_rota'], para: 'entregue' },
  DELIVERY_FINISHED: { de: ['pronto', 'em_rota'], para: 'entregue' },
  // Corrida cancelada devolve o pedido para a fila de despacho — a comida existe e
  // continua para entregar, seja por outro motoboy ou numa nova tentativa no Nexta.
  CANCELLED: { de: ['em_rota'], para: 'pronto' },
}

export interface ResultadoEvento {
  aplicado: boolean
  statusNovo: string
  statusPedido: StatusPedido | null
}

/**
 * Aplica um evento à entrega e, quando for o caso, ao pedido.
 *
 * `registrarBruto: false` na reconciliação — o payload do GET details não é um webhook
 * e sujaria o histórico com um evento que nunca chegou.
 */
export async function aplicarEventoNexta(
  admin: SupabaseClient,
  entrega: NextaEntregaLinha,
  evento: EventoNexta,
  { registrarBruto = true }: { registrarBruto?: boolean } = {}
): Promise<ResultadoEvento> {
  const tipo = texto(evento.event?.type) ?? ''

  if (registrarBruto) {
    // Histórico append-only antes de qualquer decisão: mesmo evento desconhecido ou
    // repetido fica registrado pro suporte reconstruir o que o Nexta mandou.
    await registrarEventoNextaEntrega(admin, entrega.id, { recebidoEm: new Date().toISOString(), payload: evento })
  }

  if (!tipo) return { aplicado: false, statusNovo: entrega.status, statusPedido: null }

  // Dados espelhados sempre acompanham o evento mais recente (upsert), mesmo quando o
  // tipo se repete — é assim que ETA, geo e entregador ficam frescos na tela.
  const patch: NextaEntregaPatch = {}
  const deliveryId = texto(evento.deliveryId)
  if (deliveryId && deliveryId !== entrega.deliveryId) patch.deliveryId = deliveryId

  const preco = numero(evento.deliveryPrice?.price?.value)
  if (preco !== undefined) patch.preco = preco

  const etaColeta = dataOuNull(evento.eta?.pickupEtaDatetime)
  if (etaColeta) patch.etaColeta = etaColeta
  const etaEntrega = dataOuNull(evento.eta?.deliveryEtaDatetime)
  if (etaEntrega) patch.etaEntrega = etaEntrega

  const pessoa = evento.deliveryPerson
  if (pessoa?.name) {
    patch.entregadorNome = pessoa.name
    patch.entregadorTelefone = pessoa.phone ?? ''
    patch.entregadorFotoUrl = pessoa.pictureURL ?? ''
  }

  const tracking = texto(evento.externalTrackingURL)
  if (tracking) patch.trackingUrl = tracking

  const motivo = texto(evento.event?.rejectionInfo?.reason)
  if (motivo) patch.rejeicaoMotivo = motivo

  patch.problema = Array.isArray(evento.problem) && evento.problem.length > 0 ? evento.problem : null

  // Repetição do mesmo tipo: atualiza o espelho e para por aqui (invariante 1).
  const repetido = tipo === entrega.status
  if (!repetido) patch.status = tipo

  await atualizarNextaEntrega(admin, entrega.id, patch)

  if (repetido) {
    const ehMovimento = NEXTA_EVENTOS_REPETIDOS.includes(tipo)
    if (!ehMovimento) console.warn(`[nexta] evento ${tipo} repetido na entrega ${entrega.id} — só o espelho foi atualizado.`)
    return { aplicado: false, statusNovo: entrega.status, statusPedido: null }
  }

  // Entrega saiu de cena: o pedido não pode continuar apontando pra ela, senão o painel
  // acha que ainda está "com o Nexta" e o índice parcial barra uma nova tentativa.
  if (!nextaEntregaAtiva(tipo)) {
    await desvincularEntregaDoPedido(admin, entrega.pedidoId, entrega.id)
  }

  const transicao = TRANSICAO_PEDIDO[tipo]
  if (!transicao) return { aplicado: true, statusNovo: tipo, statusPedido: null }

  // UPDATE condicional = a checagem e a escrita são atômicas no Postgres. 0 linhas
  // significa que o pedido já estava noutro estado (override manual, webhook atrasado):
  // o certo é não fazer nada, nem disparar WhatsApp.
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: transicao.para })
    .eq('id', entrega.pedidoId)
    .in('status', transicao.de)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    console.warn(`[nexta] evento ${tipo}: pedido ${entrega.pedidoId} não estava em ${transicao.de.join('/')} — status preservado.`)
    return { aplicado: true, statusNovo: tipo, statusPedido: null }
  }

  // Só notifica de verdade quando o status mudou. `pronto` fica de fora: o cliente já foi
  // avisado que o pedido estava pronto, e "voltou pra fila" não é notícia pra ele.
  if (transicao.para !== 'pronto') {
    try {
      await aplicarEfeitosStatusPedido(admin, entrega.pedidoId, transicao.para)
    } catch (err) {
      // Efeito colateral não desfaz a transição: o pedido JÁ está em rota/entregue.
      console.error(`[nexta] falha nos efeitos de ${transicao.para} no pedido ${entrega.pedidoId}:`, err)
    }
  }

  return { aplicado: true, statusNovo: tipo, statusPedido: transicao.para }
}
