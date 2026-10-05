// Tipos do v3.js (modelo oficial v3 da impressão) para a pré-visualização do painel.
import type { DocumentoTicket } from './ticket-canvas'

export interface DocumentoV3 extends DocumentoTicket {
  modelo: 'v3'
  documento: 'comanda' | 'pre_conta'
  via: 'cliente' | 'cozinha'
  teste: boolean
  loja: string
}
export interface OpcoesComandaV3 {
  config?: object
  lojaNome?: string
  loja?: unknown
  extras?: unknown
  qr?: unknown
  teste?: boolean
  via?: 'cliente' | 'cozinha'
}
/** null = pedido aguardando pagamento (não imprime). */
export function montarComandaV3(pedido: unknown, o?: OpcoesComandaV3): DocumentoV3 | null
export function montarPreContaV3(snapshot: unknown, o?: { qr?: unknown }): DocumentoV3
export function textoDoV3(doc: DocumentoV3): string
export function telefone(v: unknown): string
