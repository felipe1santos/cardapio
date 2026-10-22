import type { SupabaseClient } from '@supabase/supabase-js'
import { guardarToken, type ConfigCanal } from '../config'
import type { StatusParaApp } from '../tipos'
import { lerJsonComIdsGrandes } from './nucleo'

/**
 * Cliente da 99Food Open Platform (protocolo próprio, 22/10/2026). Base: https://openapi.99food.com.
 * App ÚNICO da Menuzia (NOVENOVE_APP_ID / NOVENOVE_APP_SECRET no Coolify); cada loja só VINCULA o estabelecimento dela
 * ao app pela página de autorização da 99Food. `app_shop_id` = id da loja no Menuzia (restaurante_id).
 *  - Página de vínculo: POST /v1/auth/authorizationpage/getUrl {app_id, app_shop_id}
 *  - Token da loja:     GET  /v1/auth/authtoken/get?app_id&app_secret&app_shop_id (1 req/30 s) · /refresh se 10101/10102
 *  - Pedido:            GET  /v1/order/order/detail · POST confirm · GET ready · GET delivered (só entrega da loja) ·
 *                       POST cancel {reason_id}
 * O pedido chega pelo webhook (orderNew, com o pedido completo); não há polling. Respostas: {errno, errmsg, data}.
 * IDs de 64 bits: lidos com lerJsonComIdsGrandes e mandados como número cru no corpo (nunca via JSON.stringify).
 */
export const BASE_99 = process.env.NOVENOVE_API_URL?.replace(/\/+$/, '') || 'https://openapi.99food.com'
const PRAZO_MS = 12_000
const ERROS_TOKEN = new Set([10100, 10101, 10102])

export class Erro99 extends Error {
  constructor(readonly errno: number, mensagem: string) { super(mensagem); this.name = 'Erro99' }
}

export interface App99 { appId: string; appSecret: string }

/** Credenciais do app da Menuzia (servidor). null = ainda não configurado no Coolify. */
export function app99(): App99 | null {
  const appId = (process.env.NOVENOVE_APP_ID ?? '').trim()
  const appSecret = (process.env.NOVENOVE_APP_SECRET ?? '').trim()
  return /^\d{6,25}$/.test(appId) && appSecret ? { appId, appSecret } : null
}

interface Resposta { errno: number; errmsg?: string; data?: unknown }

async function chamar(metodo: 'GET' | 'POST', caminho: string, params: Record<string, string | number>, corpoCru?: string): Promise<Resposta> {
  const controle = new AbortController()
  const t = setTimeout(() => controle.abort(), PRAZO_MS)
  try {
    const qs = metodo === 'GET' ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}` : ''
    const res = await fetch(`${BASE_99}${caminho}${qs}`, {
      method: metodo, signal: controle.signal,
      headers: { Accept: 'application/json', ...(metodo === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: metodo === 'POST' ? corpoCru : undefined,
    })
    const texto = await res.text()
    let j: Resposta
    try { j = lerJsonComIdsGrandes(texto) as Resposta } catch { throw new Erro99(-1, `99Food respondeu HTTP ${res.status} sem JSON`) }
    return { errno: Number(j.errno ?? -1), errmsg: j.errmsg, data: j.data }
  } finally { clearTimeout(t) }
}

/** Corpo JSON com IDs de 64 bits como número cru (a API declara order_id/app_id como integer). */
export function corpo(campos: Record<string, string | number>, numericos: string[]): string {
  return `{${Object.entries(campos).map(([k, v]) => `${JSON.stringify(k)}:${numericos.includes(k) && /^\d+$/.test(String(v)) ? String(v) : JSON.stringify(v)}`).join(',')}}`
}

/** Link da página da 99Food onde o dono vincula o estabelecimento dele ao app da Menuzia. */
export async function urlDeVinculo99(appShopId: string): Promise<string> {
  const app = app99()
  if (!app) throw new Erro99(-2, 'A Menuzia ainda não configurou o app da 99Food.')
  const r = await chamar('POST', '/v1/auth/authorizationpage/getUrl', {}, corpo({ app_id: app.appId, app_shop_id: appShopId }, ['app_id']))
  if (r.errno !== 0 || typeof r.data !== 'string') throw new Erro99(r.errno, `99Food não gerou o link de vínculo (${r.errno} ${r.errmsg ?? ''})`.trim())
  return r.data
}

/** Pede à 99Food o token da loja (e o guarda cifrado). Vencido/inexistente → refresh e tenta de novo, uma vez. */
export async function buscarToken99(admin: SupabaseClient, c: ConfigCanal, forcarRefresh = false): Promise<string> {
  const app = app99()
  if (!app) throw new Erro99(-2, 'app da 99Food não configurado')
  const params = { app_id: app.appId, app_secret: app.appSecret, app_shop_id: c.restauranteId }
  if (forcarRefresh) await chamar('GET', '/v1/auth/authtoken/refresh', params)
  let r = await chamar('GET', '/v1/auth/authtoken/get', params)
  if (r.errno !== 0 && ERROS_TOKEN.has(r.errno) && !forcarRefresh) {
    await chamar('GET', '/v1/auth/authtoken/refresh', params)
    r = await chamar('GET', '/v1/auth/authtoken/get', params)
  }
  const d = (r.data ?? {}) as { auth_token?: string; token_expiration_time?: number }
  if (r.errno !== 0 || !d.auth_token) throw new Erro99(r.errno, r.errno === 10101 ? 'Loja ainda não vinculada ao app da Menuzia na 99Food.' : `token da 99Food: ${r.errno} ${r.errmsg ?? ''}`.trim())
  const expiraSeg = Number(d.token_expiration_time) > 0 ? Number(d.token_expiration_time) - Math.floor(Date.now() / 1000) : 3600
  await guardarToken(admin, c, { accessToken: d.auth_token, expiraEmSeg: Math.max(120, expiraSeg) })
  return d.auth_token
}

async function token99(admin: SupabaseClient, c: ConfigCanal): Promise<string> {
  if (c.accessToken && c.tokenExpiraEm && Date.parse(c.tokenExpiraEm) > Date.now()) return c.accessToken
  return buscarToken99(admin, c)
}

/** Chamada de pedido com token; token recusado → renova e repete uma vez. */
async function comToken(admin: SupabaseClient, c: ConfigCanal, f: (token: string) => Promise<Resposta>): Promise<Resposta> {
  let r = await f(await token99(admin, c))
  if (r.errno !== 0 && ERROS_TOKEN.has(r.errno)) r = await f(await buscarToken99(admin, c, true))
  return r
}

export async function detalheDoPedido99(admin: SupabaseClient, c: ConfigCanal, orderId: string): Promise<unknown> {
  const r = await comToken(admin, c, (auth_token) => chamar('GET', '/v1/order/order/detail', { auth_token, order_id: orderId }))
  if (r.errno !== 0) throw new Erro99(r.errno, `detalhe do pedido 99Food: ${r.errno} ${r.errmsg ?? ''}`.trim())
  return r.data
}

/** Motivo do Kanban → reason_id da 99Food (1060/1071/1072 só valem em entrega da loja). Puro. */
export function motivoCancelamento99(motivo: string | null | undefined, entregaPelaLoja: boolean): number {
  switch (motivo) {
    case 'sem_estoque': return 1010
    case 'cliente_desistiu': case 'pix_expirado': case 'pagamento_expirado': return 1050
    case 'trote': return 1073
    case 'nao_entregue': return entregaPelaLoja ? 1060 : 1080
    default: return 1080
  }
}

/** Status do Kanban → 99Food. 'preparando' e 'despachado' não têm chamada (o confirmar já é "aceito e preparando";
 *  quem despacha na entrega da 99 é o entregador dela). 'entregue' só existe na entrega da loja. */
export async function enviarStatus99(admin: SupabaseClient, c: ConfigCanal, orderId: string, etapa: StatusParaApp, extra: { entregaPelaLoja: boolean; motivo?: string | null; texto?: string | null }): Promise<'ok' | 'sem_acao'> {
  let r: Resposta | null = null
  if (etapa === 'confirmado') r = await comToken(admin, c, (auth_token) => chamar('POST', '/v1/order/order/confirm', {}, corpo({ auth_token, order_id: orderId }, ['order_id'])))
  else if (etapa === 'pronto') r = await comToken(admin, c, (auth_token) => chamar('GET', '/v1/order/order/ready', { auth_token, order_id: orderId }))
  else if (etapa === 'entregue' && extra.entregaPelaLoja) r = await comToken(admin, c, (auth_token) => chamar('GET', '/v1/order/order/delivered', { auth_token, order_id: orderId }))
  else if (etapa === 'cancelado') {
    const reason_id = motivoCancelamento99(extra.motivo, extra.entregaPelaLoja)
    r = await comToken(admin, c, (auth_token) => chamar('POST', '/v1/order/order/cancel', {}, corpo({ auth_token, order_id: orderId, reason_id, reason: (extra.texto ?? '').slice(0, 200) || 'Cancelado pela loja' }, ['order_id', 'reason_id'])))
  }
  if (!r) return 'sem_acao'
  if (r.errno !== 0) throw new Erro99(r.errno, `99Food ${etapa}: ${r.errno} ${r.errmsg ?? ''}`.trim())
  return 'ok'
}
