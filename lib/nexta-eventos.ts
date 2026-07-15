/**
 * Enums, rótulos e regras de estado da integração Nexta (Open Delivery).
 *
 * Vive separado de `lib/nexta.ts` de propósito: o painel (client) precisa destes
 * valores para desenhar badges e timelines, e `lib/nexta.ts` importa `node:crypto`,
 * que não pode entrar no bundle do browser.
 */

/** Ciclo de vida de uma entrega no padrão Open Delivery. */
export const NEXTA_EVENTOS = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'PICKUP_ONGOING',
  'ARRIVED_AT_MERCHANT',
  'ORDER_PICKED',
  'DELIVERY_ONGOING',
  'ARRIVED_AT_CUSTOMER',
  'ORDER_DELIVERED',
  'DELIVERY_FINISHED',
  'RETURNING_TO_MERCHANT',
  'RETURNED_TO_MERCHANT',
  'CANCELLED',
] as const

export type NextaEvento = (typeof NEXTA_EVENTOS)[number]

/**
 * Eventos em que a entrega deixou de estar ativa — liberam o pedido para um novo
 * despacho. Precisa bater EXATAMENTE com o índice parcial
 * `nexta_entregas_ativa_por_pedido` da migration 0042.
 */
export const NEXTA_EVENTOS_TERMINAIS: string[] = [
  'REJECTED',
  'CANCELLED',
  'ORDER_DELIVERED',
  'DELIVERY_FINISHED',
  'RETURNED_TO_MERCHANT',
]

export function nextaEntregaAtiva(status: string): boolean {
  return !NEXTA_EVENTOS_TERMINAIS.includes(status)
}

/** Eventos que se repetem periodicamente com geolocalização nova (upsert, não transição). */
export const NEXTA_EVENTOS_REPETIDOS: string[] = ['PICKUP_ONGOING', 'DELIVERY_ONGOING', 'RETURNING_TO_MERCHANT']

const EVENTO_LABEL: Record<string, string> = {
  PENDING: 'Aguardando aceite',
  ACCEPTED: 'Aceito',
  REJECTED: 'Recusado',
  PICKUP_ONGOING: 'Entregador a caminho da loja',
  ARRIVED_AT_MERCHANT: 'Entregador na loja',
  ORDER_PICKED: 'Pedido coletado',
  DELIVERY_ONGOING: 'A caminho do cliente',
  ARRIVED_AT_CUSTOMER: 'No cliente',
  ORDER_DELIVERED: 'Entregue',
  DELIVERY_FINISHED: 'Finalizada',
  RETURNING_TO_MERCHANT: 'Voltando para a loja',
  RETURNED_TO_MERCHANT: 'Devolvido à loja',
  CANCELLED: 'Cancelada',
}

/** Rótulo em PT-BR do evento. Eventos novos (a spec permite) aparecem crus, sem quebrar. */
export function nextaEventoTexto(evento: string): string {
  return EVENTO_LABEL[evento] ?? evento
}

/** Tom do badge do evento, no vocabulário do `<Badge>` do design system. */
export function nextaEventoTom(evento: string): 'ok' | 'danger' | 'pending' | 'preparing' | 'alert' {
  if (evento === 'REJECTED' || evento === 'CANCELLED') return 'danger'
  if (evento === 'ORDER_DELIVERED' || evento === 'DELIVERY_FINISHED') return 'ok'
  if (evento === 'PENDING') return 'pending'
  if (evento === 'RETURNING_TO_MERCHANT' || evento === 'RETURNED_TO_MERCHANT') return 'pending'
  if (evento === 'ORDER_PICKED' || evento === 'DELIVERY_ONGOING' || evento === 'ARRIVED_AT_CUSTOMER') return 'preparing'
  return 'alert'
}

const MOTIVO_REJEICAO_LABEL: Record<string, string> = {
  PRICE_EXCEEDED: 'Preço acima do limite',
  VEHICLE_NOT_AVAILABLE: 'Veículo indisponível',
  NO_DELIVERYPERSON_AVAILABLE: 'Sem entregador disponível agora',
  DOES_NOT_MEET_REQUESTED_TIMES: 'Não atende os tempos solicitados',
  REGION_NOT_SERVED: 'Região não atendida',
  INVALID_ADDRESS: 'Endereço inválido',
  OTHER: 'Outro motivo',
}

/** Motivo de rejeição do Nexta em português, pro card do painel. */
export function motivoRejeicaoTexto(motivo: string | null): string {
  if (!motivo) return 'Motivo não informado'
  return MOTIVO_REJEICAO_LABEL[motivo] ?? motivo
}

/** AppId do Nexta no diretório Open Delivery — chega no header `X-App-Id` dos webhooks. */
export const NEXTA_APP_ID = '2037180933127'
