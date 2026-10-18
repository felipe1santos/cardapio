import { createHmac } from 'node:crypto'

/**
 * Regras PURAS da integração Lalamove (API v3) — sem rede e sem banco, testáveis.
 * Documentação lida em 18/10/2026: developers.lalamove.com (mercado BR, HMAC, cotação, pedido, webhook, cancelamento).
 *
 * Client-safe? NÃO: importa node:crypto. O que a tela precisa (texto de status, cidades) está em
 * `lalamove-cidades.ts` e `lalamove-status.ts`.
 */

// As URLs da API moram em lib/custo/lalamove.ts (Regra nº 1: só lá se fala com a Lalamove).
export type AmbienteLalamove = 'sandbox' | 'producao'
export const MERCADO_BR = 'BR'
export const IDIOMA_BR = 'pt_BR'

export interface ChavesLalamove { apiKey: string; apiSecret: string }

/**
 * Assinatura HMAC-SHA256 (hex minúsculo) de `<TIMESTAMP>\r\n<VERBO>\r\n<CAMINHO>\r\n\r\n<CORPO>`, chave = secret.
 * `caminho` inclui a versão (ex.: /v3/quotations). GET e DELETE vão com corpo vazio.
 */
export function assinarLalamove(secret: string, timestampMs: number, metodo: string, caminho: string, corpo: string): string {
  return createHmac('sha256', secret).update(`${timestampMs}\r\n${metodo.toUpperCase()}\r\n${caminho}\r\n\r\n${corpo}`, 'utf8').digest('hex')
}

/** Cabeçalhos de uma chamada: Authorization `hmac KEY:TS:ASSINATURA`, Market e Request-ID. */
export function cabecalhosLalamove(chaves: ChavesLalamove, metodo: string, caminho: string, corpo: string, timestampMs: number, requestId: string): Record<string, string> {
  const assinatura = assinarLalamove(chaves.apiSecret, timestampMs, metodo, caminho, corpo)
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `hmac ${chaves.apiKey}:${timestampMs}:${assinatura}`,
    Market: MERCADO_BR,
    'Request-ID': requestId,
  }
}

/** Chave de teste começa com pk_test/sk_test; de produção com pk_prod/sk_prod. Tolerante a formato novo. */
export function ambienteDaChave(apiKey: string): AmbienteLalamove | null {
  if (/^pk_test_/i.test(apiKey)) return 'sandbox'
  if (/^pk_prod_/i.test(apiKey)) return 'producao'
  return null
}

/** "••••abcd" — só os 4 últimos; a tela nunca vê a chave inteira. */
export function finalDaChave(apiKey: string): string {
  return apiKey.trim().slice(-4)
}

/** Telefone BR no formato internacional que a Lalamove espera (+55DDNNNNNNNNN). */
export function telefoneLalamove(telefone: string | null | undefined): string {
  const d = String(telefone ?? '').replace(/\D/g, '')
  if (!d) return ''
  return d.startsWith('55') && d.length >= 12 ? `+${d}` : `+55${d}`
}

export interface ParadaLalamove { lat: number; lng: number; endereco: string }

/** Corpo de POST /v3/quotations: loja (parada 0) → cliente (parada 1). Coordenadas como string, como a API pede. */
export function montarCotacao(servico: string, loja: ParadaLalamove, cliente: ParadaLalamove): Record<string, unknown> {
  const parada = (p: ParadaLalamove) => ({ coordinates: { lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }, address: p.endereco.slice(0, 250) })
  return { data: { serviceType: servico, language: IDIOMA_BR, stops: [parada(loja), parada(cliente)], isRouteOptimized: false } }
}

export interface RespostaCotacao {
  quotationId: string
  expiraEm: string | null
  preco: number
  moeda: string
  distanciaM: number | null
  paradas: string[]
}

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Lê a resposta da cotação (envelope `data`). Null se não vier preço ou id. */
export function lerCotacao(bruto: unknown): RespostaCotacao | null {
  const d = ((bruto as { data?: unknown } | null)?.data ?? bruto) as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return null
  const id = texto(d.quotationId)
  const pb = d.priceBreakdown as { total?: unknown; currency?: unknown } | undefined
  const preco = numero(pb?.total)
  if (!id || preco === null) return null
  const dist = d.distance as { value?: unknown; unit?: unknown } | undefined
  let distanciaM = numero(dist?.value)
  if (distanciaM !== null && String(dist?.unit ?? 'm').toLowerCase() === 'km') distanciaM = Math.round(distanciaM * 1000)
  const paradas = Array.isArray(d.stops) ? d.stops.map((s) => texto((s as { stopId?: unknown })?.stopId) ?? '') : []
  return { quotationId: id, expiraEm: texto(d.expiresAt), preco, moeda: texto(pb?.currency) ?? 'BRL', distanciaM, paradas }
}

export interface PedidoParaLalamove { numero: number; clienteNome: string; clienteTelefone: string; observacao: string; complemento: string; referencia: string }

/** Corpo de POST /v3/orders a partir da cotação (stopIds) + dados da loja e do cliente. */
export function montarPedido(cotacao: RespostaCotacao, loja: { nome: string; telefone: string }, pedido: PedidoParaLalamove, pedidoId: string): Record<string, unknown> {
  const [paradaLoja, paradaCliente] = cotacao.paradas
  const obs = [pedido.complemento && `Compl.: ${pedido.complemento}`, pedido.referencia && `Ref.: ${pedido.referencia}`, pedido.observacao && `Obs.: ${pedido.observacao}`]
    .filter(Boolean).join(' · ').slice(0, 200)
  return {
    data: {
      quotationId: cotacao.quotationId,
      sender: { stopId: paradaLoja, name: loja.nome.slice(0, 60) || 'Loja', phone: telefoneLalamove(loja.telefone) },
      recipients: [{ stopId: paradaCliente, name: (pedido.clienteNome || 'Cliente').slice(0, 60), phone: telefoneLalamove(pedido.clienteTelefone), ...(obs ? { remarks: obs } : {}) }],
      isPODEnabled: false,
      metadata: { menuziaPedidoId: pedidoId, numero: String(pedido.numero) },
    },
  }
}

export type StatusLalamove = 'ASSIGNING_DRIVER' | 'ON_GOING' | 'PICKED_UP' | 'COMPLETED' | 'CANCELED' | 'REJECTED' | 'EXPIRED'
export const STATUS_ATIVOS: readonly string[] = ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']
export const STATUS_FIM_SEM_ENTREGA: readonly string[] = ['CANCELED', 'REJECTED', 'EXPIRED']
export const corridaAtiva = (status: string) => STATUS_ATIVOS.includes(status)

export interface PedidoLalamove {
  orderId: string
  status: string
  shareLink: string | null
  driverId: string | null
  preco: number | null
  distanciaM: number | null
}

/** Lê GET /v3/orders/{id} (envelope `data`). */
export function lerPedido(bruto: unknown): PedidoLalamove | null {
  const d = ((bruto as { data?: unknown } | null)?.data ?? bruto) as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return null
  const orderId = texto(d.orderId)
  const status = texto(d.status)
  if (!orderId || !status) return null
  const pb = d.priceBreakdown as { total?: unknown } | undefined
  const dist = d.distance as { value?: unknown; unit?: unknown } | undefined
  let distanciaM = numero(dist?.value)
  if (distanciaM !== null && String(dist?.unit ?? 'm').toLowerCase() === 'km') distanciaM = Math.round(distanciaM * 1000)
  return { orderId, status: status.toUpperCase(), shareLink: texto(d.shareLink), driverId: texto(d.driverId), preco: numero(pb?.total), distanciaM }
}

export interface MotoristaLalamove { driverId: string; nome: string; telefone: string; placa: string }

/** Lê GET /v3/orders/{id}/drivers/{driverId}. */
export function lerMotorista(bruto: unknown): MotoristaLalamove | null {
  const d = ((bruto as { data?: unknown } | null)?.data ?? bruto) as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return null
  const id = texto(d.driverId)
  if (!id) return null
  return { driverId: id, nome: texto(d.name) ?? '', telefone: texto(d.phone) ?? '', placa: texto(d.plateNumber) ?? '' }
}

/** orderId de um webhook (ORDER_STATUS_CHANGED, DRIVER_ASSIGNED…), tolerante às formas do envelope. */
export function orderIdDoWebhook(corpo: unknown): string | null {
  const c = corpo as Record<string, unknown> | null
  if (!c || typeof c !== 'object') return null
  const data = c.data as Record<string, unknown> | undefined
  const order = data?.order as Record<string, unknown> | undefined
  return texto(order?.orderId) ?? texto(data?.orderId) ?? texto(c.orderId)
}

/** Tipo do evento do webhook (ex.: ORDER_STATUS_CHANGED), ou '' se não vier. */
export function tipoDoWebhook(corpo: unknown): string {
  const c = corpo as Record<string, unknown> | null
  return texto(c?.eventType) ?? texto(c?.type) ?? ''
}

export interface CidadeLalamove { locode: string; nome: string; servicos: string[] }

/** Lê GET /v3/cities. */
export function lerCidades(bruto: unknown): CidadeLalamove[] {
  const d = ((bruto as { data?: unknown } | null)?.data ?? bruto) as unknown
  if (!Array.isArray(d)) return []
  return d.flatMap((c) => {
    const o = c as Record<string, unknown>
    const locode = texto(o.locode)
    if (!locode) return []
    const servicos = Array.isArray(o.services) ? o.services.map((s) => texto((s as { key?: unknown })?.key) ?? '').filter(Boolean) : []
    return [{ locode, nome: texto(o.name) ?? locode, servicos }]
  })
}

/** Primeiro serviço de moto (MOTORCYCLE, LALAGO…); senão o primeiro da lista. */
export function servicoDeMoto(servicos: string[]): string {
  return servicos.find((s) => /MOTOR|MOTO|LALAGO|LALAPRO|BIKE/i.test(s)) ?? servicos[0] ?? 'MOTORCYCLE'
}

/**
 * Mensagem para o lojista a partir do erro da Lalamove. "Fora da área" vira a frase pedida pelo dono
 * ("Lalamove ainda não atende sua cidade"), sem erro técnico.
 */
export const MSG_FORA_DA_AREA = 'Lalamove ainda não atende sua cidade.'
export function mensagemErroLalamove(status: number, corpo: unknown): string {
  const o = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>
  const msg = String(o.message ?? (o.errors as { message?: unknown }[] | undefined)?.[0]?.message ?? o.error ?? '')
  const detalhe = String((o.errors as { detail?: unknown }[] | undefined)?.[0]?.detail ?? '')
  const tudo = `${msg} ${detalhe}`.toUpperCase()
  if (/OUT_OF_SERVICE|SERVICE_AREA|OUTSIDE|NOT_SUPPORTED|UNSUPPORTED|INVALID_MARKET|ERR_INVALID_LOCATION|UNSERVICEABLE/.test(tudo)) return MSG_FORA_DA_AREA
  if (status === 401) return 'Chaves da Lalamove recusadas. Confira a API key e o secret em Integrações › Lalamove.'
  if (status === 402 || /INSUFFICIENT|CREDIT|BALANCE/.test(tudo)) return 'Sem saldo na carteira Lalamove da loja. Recarregue no portal da Lalamove.'
  if (status === 409 && /CANCELLATION_FORBIDDEN/.test(tudo)) return 'A Lalamove não permite mais cancelar esta corrida (o entregador aceitou há mais de 5 minutos).'
  if (/ERR_INVALID_QUOTATION|QUOTATION/.test(tudo)) return 'A cotação venceu (vale 5 minutos). Cote de novo.'
  if (status === 429) return 'Muitas chamadas à Lalamove em pouco tempo. Aguarde um minuto.'
  if (status >= 500) return 'A Lalamove está indisponível no momento. Tente de novo em instantes.'
  return msg ? `Lalamove: ${msg.slice(0, 160)}` : `A Lalamove respondeu ${status}.`
}
