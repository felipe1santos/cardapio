import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { guardarToken, type ConfigCanal } from '../config'
import type { StatusParaApp } from '../tipos'

/**
 * Cliente Open Delivery (Abrasel v1.x) do lado do SOFTWARE SERVICE (nós). O app (Keeta, 99Food) é o ORDERING
 * APPLICATION: dá clientId/clientSecret, emite o token em `${baseUrl}/oauth/token` (client_credentials), expõe
 * `GET /v1/events:polling`, `POST /v1/events/acknowledgment`, `GET /v1/orders/{id}` e os POSTs de status. Nós expomos
 * o webhook `POST /v1/newEvent` (app/api/canais/opendelivery/webhook/[token]) e `GET /v1/merchant` (cardápio).
 *
 * Regra nº 1 de custo não se aplica (API dos apps é gratuita), mas o polling é limitado: 1 chamada por loja por
 * minuto (cron), com x-polling-merchants quando o app pede. Nenhuma chamada no navegador.
 */
const PRAZO_MS = 12_000

export interface EventoOd { eventId: string; eventType: string; orderId: string; orderURL?: string; createdAt?: string; sourceAppId?: string }

export class ErroOd extends Error {
  constructor(readonly status: number, mensagem: string) { super(mensagem); this.name = 'ErroOd' }
}

async function chamar(url: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const controle = new AbortController()
  const t = setTimeout(() => controle.abort(), PRAZO_MS)
  try {
    return await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) }, signal: controle.signal })
  } finally { clearTimeout(t) }
}

/** Token client_credentials, com cache cifrado em canais_config (expires_in − 60 s). */
export async function tokenOd(admin: SupabaseClient, c: ConfigCanal): Promise<string> {
  if (!c.credenciais || !c.baseUrl) throw new ErroOd(401, 'canal sem credenciais ou sem URL base')
  if (c.accessToken && c.tokenExpiraEm && Date.parse(c.tokenExpiraEm) > Date.now()) return c.accessToken
  const res = await chamar(`${c.baseUrl}/oauth/token`, { method: 'POST', body: JSON.stringify({ grant_type: 'client_credentials', client_id: c.credenciais.clientId, client_secret: c.credenciais.clientSecret }) })
  if (!res.ok) throw new ErroOd(res.status, `token: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const j = (await res.json()) as { access_token?: string; accessToken?: string; expires_in?: number; expiresIn?: number }
  const token = j.access_token ?? j.accessToken
  if (!token) throw new ErroOd(502, 'token: resposta sem access_token')
  await guardarToken(admin, c, { accessToken: token, expiraEmSeg: Number(j.expires_in ?? j.expiresIn ?? 3600) })
  return token
}

export async function pollingOd(admin: SupabaseClient, c: ConfigCanal): Promise<EventoOd[]> {
  const token = await tokenOd(admin, c)
  const res = await chamar(`${c.baseUrl}/v1/events:polling`, { token, headers: c.merchantIdExterno ? { 'x-polling-merchants': c.merchantIdExterno } : {} })
  if (res.status === 204) return []
  if (!res.ok) throw new ErroOd(res.status, `polling: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const j = (await res.json().catch(() => [])) as unknown
  const lista = Array.isArray(j) ? j : Array.isArray((j as { events?: unknown[] })?.events) ? (j as { events: unknown[] }).events : []
  return lista.filter((e): e is EventoOd => !!e && typeof e === 'object' && typeof (e as EventoOd).eventId === 'string')
}

export async function acknowledgmentOd(admin: SupabaseClient, c: ConfigCanal, eventos: EventoOd[]): Promise<void> {
  if (!eventos.length) return
  const token = await tokenOd(admin, c)
  const res = await chamar(`${c.baseUrl}/v1/events/acknowledgment`, { method: 'POST', token, body: JSON.stringify(eventos.map((e) => ({ eventId: e.eventId, eventType: e.eventType, orderId: e.orderId }))) })
  if (!res.ok) throw new ErroOd(res.status, `acknowledgment: HTTP ${res.status}`)
}

export async function detalheDoPedidoOd(admin: SupabaseClient, c: ConfigCanal, orderId: string, orderURL?: string): Promise<unknown> {
  const token = await tokenOd(admin, c)
  const url = orderURL && /^https?:\/\//.test(orderURL) ? orderURL : `${c.baseUrl}/v1/orders/${encodeURIComponent(orderId)}`
  const res = await chamar(url, { token })
  if (!res.ok) throw new ErroOd(res.status, `pedido: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  return res.json()
}

const CAMINHO: Record<StatusParaApp, string> = { confirmado: 'confirm', preparando: 'preparing', pronto: 'readyForPickup', despachado: 'dispatch', entregue: 'delivered', cancelado: 'requestCancellation' }

/** Manda uma etapa ao app. 409/422 = o app já estava nessa etapa (ou além): tratamos como feito. */
export async function enviarStatusOd(admin: SupabaseClient, c: ConfigCanal, orderId: string, etapa: StatusParaApp, extra: { motivoCancelamento?: string } = {}): Promise<'ok' | 'ja_estava'> {
  const token = await tokenOd(admin, c)
  const corpo = etapa === 'confirmado' ? { createdAt: new Date().toISOString(), orderExternalCode: orderId }
    : etapa === 'cancelado' ? { reason: (extra.motivoCancelamento ?? 'Cancelado pela loja').slice(0, 200), code: 'SYSTEMIC_ISSUES', mode: 'AUTO', outOfStockItems: [], invalidItems: [] }
    : {}
  const res = await chamar(`${c.baseUrl}/v1/orders/${encodeURIComponent(orderId)}/${CAMINHO[etapa]}`, { method: 'POST', token, body: JSON.stringify(corpo) })
  if (res.ok || res.status === 202) return 'ok'
  if (res.status === 409 || res.status === 422) return 'ja_estava'
  throw new ErroOd(res.status, `${CAMINHO[etapa]}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
}

/**
 * Assinatura do webhook (spec: X-App-Signature = HMAC-SHA256 do corpo com o client secret). Aceita hex e base64
 * (a Keeta usa base64 com o corpo canonizado — quando o corpo chega como o app mandou, o hash bate igual).
 */
export function assinaturaOdValida(corpoBruto: string, assinatura: string | null, clientSecret: string | null): boolean {
  if (!assinatura || !clientSecret) return false
  const mac = createHmac('sha256', clientSecret).update(corpoBruto, 'utf8').digest()
  const candidatos = [mac.toString('hex'), mac.toString('base64'), mac.toString('base64url')]
  const dada = assinatura.trim()
  for (const c of candidatos) {
    if (c.length !== dada.length) continue
    if (timingSafeEqual(Buffer.from(c), Buffer.from(dada))) return true
  }
  return false
}
