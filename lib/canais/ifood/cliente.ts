import type { SupabaseClient } from '@supabase/supabase-js'
import { guardarToken, type ConfigCanal } from '../config'
import type { StatusParaApp } from '../tipos'

/**
 * Cliente da iFood Merchant API (v1.0). Base fixa: https://merchant-api.ifood.com.br.
 *  - Autenticação: POST /authentication/v1.0/oauth/token (form). App CENTRALIZADO: grantType=client_credentials
 *    (clientId/clientSecret do portal do desenvolvedor). App DISTRIBUÍDO: o lojista gera um código em
 *    POST /authentication/v1.0/oauth/userCode (userCode + authorizationCodeVerifier), autoriza no Portal do Parceiro e
 *    devolve o authorizationCode → grantType=authorization_code → accessToken + refreshToken (renovado por refresh_token).
 *  - Eventos: GET /events/v1.0/events:polling (x-polling-merchants) a cada 30 s; POST /events/v1.0/events/acknowledgment.
 *  - Pedido: GET /order/v1.0/orders/{id}; ações POST /order/v1.0/orders/{id}/confirm | startPreparation | readyToPickup |
 *    dispatch | requestCancellation ({ reason, cancellationCode }).
 *  - Lojas: GET /merchant/v1.0/merchants (para descobrir o merchantId).
 * Portal/credenciais/homologação são do dono (ver relatório). Nenhuma chamada no navegador.
 */
export const IFOOD_BASE = 'https://merchant-api.ifood.com.br'
const PRAZO_MS = 12_000

export interface EventoIfood { id: string; code: string; fullCode?: string; orderId: string; merchantId?: string; createdAt?: string; metadata?: Record<string, unknown> }

export class ErroIfood extends Error {
  constructor(readonly status: number, mensagem: string) { super(mensagem); this.name = 'ErroIfood' }
}

async function chamar(caminho: string, init: RequestInit & { token?: string; form?: Record<string, string> } = {}): Promise<Response> {
  const controle = new AbortController()
  const t = setTimeout(() => controle.abort(), PRAZO_MS)
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...((init.headers as Record<string, string>) ?? {}) }
    let body = init.body
    if (init.form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(init.form).toString() }
    else if (body) headers['Content-Type'] = 'application/json'
    return await fetch(`${IFOOD_BASE}${caminho}`, { ...init, headers, body, signal: controle.signal })
  } finally { clearTimeout(t) }
}

/** Passo 1 do app distribuído: código que o lojista digita no Portal do Parceiro. */
export async function pedirUserCodeIfood(c: ConfigCanal): Promise<{ userCode: string; verificationUrlComplete: string; authorizationCodeVerifier: string; expiresIn: number }> {
  if (!c.credenciais) throw new ErroIfood(401, 'sem clientId')
  const res = await chamar('/authentication/v1.0/oauth/userCode', { method: 'POST', form: { clientId: c.credenciais.clientId } })
  if (!res.ok) throw new ErroIfood(res.status, `userCode: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const j = (await res.json()) as { userCode: string; verificationUrlComplete: string; authorizationCodeVerifier: string; expiresIn: number }
  return j
}

/** Passo 2 do app distribuído: troca o authorizationCode (que o lojista cola) por access + refresh token. */
export async function autorizarIfood(admin: SupabaseClient, c: ConfigCanal, authorizationCode: string, authorizationCodeVerifier: string): Promise<void> {
  if (!c.credenciais) throw new ErroIfood(401, 'sem credenciais')
  const res = await chamar('/authentication/v1.0/oauth/token', { method: 'POST', form: { grantType: 'authorization_code', clientId: c.credenciais.clientId, clientSecret: c.credenciais.clientSecret, authorizationCode, authorizationCodeVerifier } })
  if (!res.ok) throw new ErroIfood(res.status, `autorização: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const j = (await res.json()) as { accessToken: string; refreshToken?: string; expiresIn: number }
  await guardarToken(admin, c, { accessToken: j.accessToken, expiraEmSeg: Number(j.expiresIn ?? 3600), refreshToken: j.refreshToken ?? null })
}

/** Token válido: cache → refresh_token (distribuído) → client_credentials (centralizado). */
export async function tokenIfood(admin: SupabaseClient, c: ConfigCanal): Promise<string> {
  if (!c.credenciais) throw new ErroIfood(401, 'canal sem credenciais')
  if (c.accessToken && c.tokenExpiraEm && Date.parse(c.tokenExpiraEm) > Date.now()) return c.accessToken
  const form: Record<string, string> = c.refreshToken
    ? { grantType: 'refresh_token', clientId: c.credenciais.clientId, clientSecret: c.credenciais.clientSecret, refreshToken: c.refreshToken ?? '' }
    : { grantType: 'client_credentials', clientId: c.credenciais.clientId, clientSecret: c.credenciais.clientSecret }
  const res = await chamar('/authentication/v1.0/oauth/token', { method: 'POST', form })
  if (!res.ok) throw new ErroIfood(res.status, `token: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const j = (await res.json()) as { accessToken: string; refreshToken?: string; expiresIn: number }
  await guardarToken(admin, c, { accessToken: j.accessToken, expiraEmSeg: Number(j.expiresIn ?? 3600), ...(j.refreshToken ? { refreshToken: j.refreshToken } : {}) })
  return j.accessToken
}

export async function lojasIfood(admin: SupabaseClient, c: ConfigCanal): Promise<{ id: string; name: string }[]> {
  const token = await tokenIfood(admin, c)
  const res = await chamar('/merchant/v1.0/merchants', { token })
  if (!res.ok) throw new ErroIfood(res.status, `merchants: HTTP ${res.status}`)
  const j = (await res.json().catch(() => [])) as { id: string; name: string }[]
  return Array.isArray(j) ? j : []
}

export async function pollingIfood(admin: SupabaseClient, c: ConfigCanal): Promise<EventoIfood[]> {
  const token = await tokenIfood(admin, c)
  const res = await chamar('/events/v1.0/events:polling', { token, headers: c.merchantIdExterno ? { 'x-polling-merchants': c.merchantIdExterno } : {} })
  if (res.status === 204) return []
  if (!res.ok) throw new ErroIfood(res.status, `polling: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const j = (await res.json().catch(() => [])) as unknown
  return (Array.isArray(j) ? j : []).filter((e): e is EventoIfood => !!e && typeof e === 'object' && typeof (e as EventoIfood).id === 'string')
}

export async function acknowledgmentIfood(admin: SupabaseClient, c: ConfigCanal, eventos: EventoIfood[]): Promise<void> {
  if (!eventos.length) return
  const token = await tokenIfood(admin, c)
  const res = await chamar('/events/v1.0/events/acknowledgment', { method: 'POST', token, body: JSON.stringify(eventos.map((e) => ({ id: e.id }))) })
  if (!res.ok && res.status !== 202) throw new ErroIfood(res.status, `acknowledgment: HTTP ${res.status}`)
}

export async function detalheDoPedidoIfood(admin: SupabaseClient, c: ConfigCanal, orderId: string): Promise<unknown> {
  const token = await tokenIfood(admin, c)
  const res = await chamar(`/order/v1.0/orders/${encodeURIComponent(orderId)}`, { token })
  if (!res.ok) throw new ErroIfood(res.status, `pedido: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`)
  return res.json()
}

const CAMINHO: Partial<Record<StatusParaApp, string>> = { confirmado: 'confirm', preparando: 'startPreparation', pronto: 'readyToPickup', despachado: 'dispatch', cancelado: 'requestCancellation' }

/** Motivos que o iFood aceita para ESTE pedido (a lista muda por pedido; 204 = nenhum). Sem lista fixa, como pede a doc. */
export async function motivosCancelamentoIfood(admin: SupabaseClient, c: ConfigCanal, orderId: string): Promise<{ codigo: string; descricao: string }[]> {
  const token = await tokenIfood(admin, c)
  const res = await chamar(`/order/v1.0/orders/${encodeURIComponent(orderId)}/cancellationReasons`, { token })
  if (res.status === 204) return []
  if (!res.ok) throw new ErroIfood(res.status, `cancellationReasons: HTTP ${res.status}`)
  const j = (await res.json().catch(() => null)) as { reasons?: { code?: unknown; description?: unknown }[] } | null
  return (Array.isArray(j?.reasons) ? j.reasons : []).filter((m) => m.code).map((m) => ({ codigo: String(m.code), descricao: String(m.description ?? m.code) }))
}

/** Manda uma etapa ao iFood ("entregue" não existe: o app conclui sozinho). 400 "already" / 409 = já estava. */
export async function enviarStatusIfood(admin: SupabaseClient, c: ConfigCanal, orderId: string, etapa: StatusParaApp, extra: { codigoCancelamento?: string; entregaPelaLoja?: boolean } = {}): Promise<'ok' | 'ja_estava' | 'nao_se_aplica'> {
  const caminho = CAMINHO[etapa]
  if (!caminho) return 'nao_se_aplica'
  // /dispatch é só de entrega própria; com o entregador do iFood quem avança é o próprio iFood.
  if (etapa === 'despachado' && !extra.entregaPelaLoja) return 'nao_se_aplica'
  const token = await tokenIfood(admin, c)
  const corpo = etapa === 'cancelado' ? JSON.stringify({ reason: extra.codigoCancelamento || '501' })
    : etapa === 'despachado' ? JSON.stringify({ deliveredBy: 'MERCHANT' }) : undefined
  const res = await chamar(`/order/v1.0/orders/${encodeURIComponent(orderId)}/${caminho}`, { method: 'POST', token, body: corpo })
  if (res.ok || res.status === 202) return 'ok'
  const texto = await res.text().catch(() => '')
  if (res.status === 409 || (res.status === 400 && /already|já/i.test(texto))) return 'ja_estava'
  throw new ErroIfood(res.status, `${caminho}: HTTP ${res.status} ${texto.slice(0, 160)}`)
}

/** Códigos de evento do iFood que importam para o Kanban. */
export const EVENTO_IFOOD = { PLACED: 'PLC', CONFIRMED: 'CFM', CANCELLED: 'CAN', CANCELLATION_REQUESTED: 'CAR', DISPATCHED: 'DSP', CONCLUDED: 'CON', PATCHED: 'OPA' } as const
