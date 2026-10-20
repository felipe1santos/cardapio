import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'

/**
 * Foody Delivery pelo padrão Open Delivery — módulo LOGISTICS (Etapa 3, 19/10). A Foody é o LOGISTIC SERVICE: dá
 * clientId/clientSecret (Menu › Minha conta › APIs e Hooks › credencial Open Delivery) e a URL base; nós chamamos
 *   POST /oauth/token (client_credentials)      POST /v1/logistics/availability (preço/ETA, não cria nada)
 *   POST /v1/logistics/delivery (cria a entrega) POST /v1/logistics/cancel/{orderId}
 *   POST /v1/logistics/readyForPickup/{orderId}  GET  /v1/logistics/delivery/{orderId}
 * e recebemos o webhook /deliveryUpdate (newLogisticEvent) em app/api/entregas/foody/webhook/[token].
 * API PAGA pela loja → só este arquivo fala com ela, por `chamarApiPaga` (api 'foody', LIMITE_FOODY_DIA). Serve para
 * qualquer logística Open Delivery, não só a Foody.
 */
const TIMEOUT_MS = 15_000
const tokens = new Map<string, { token: string; expira: number }>()

export class FoodyError extends Error { constructor(m: string, readonly status: number, readonly corpo: unknown = null) { super(m); this.name = 'FoodyError' } }

/** `api`/`nome` (20/10): o mesmo cliente serve a Machine (Gaudium) — conta na guarda dela e fala o nome dela nos erros. */
export interface ContaFoody { baseUrl: string; clientId: string; clientSecret: string; api?: 'foody' | 'machine'; nome?: string }
const nomeDe = (c: ContaFoody) => c.nome ?? 'Foody'

async function token(conta: ContaFoody): Promise<string> {
  const chave = `${conta.baseUrl}|${conta.clientId}`
  const nome = nomeDe(conta)
  const c = tokens.get(chave)
  if (c && c.expira > Date.now()) return c.token
  const res = await fetch(`${conta.baseUrl}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: conta.clientId, client_secret: conta.clientSecret }), signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new FoodyError(res.status === 401 ? `${nome} recusou as credenciais.` : `${nome} (token) respondeu ${res.status}.`, res.status)
  const j = (await res.json()) as { access_token?: string; accessToken?: string; expires_in?: number }
  const t = j.access_token ?? j.accessToken
  if (!t) throw new FoodyError(`${nome} não devolveu o token.`, 502)
  tokens.set(chave, { token: t, expira: Date.now() + Math.max(60, Number(j.expires_in ?? 3600) - 60) * 1000 })
  return t
}

async function chamar(admin: SupabaseClient, loja: string, conta: ContaFoody, metodo: 'GET' | 'POST', caminho: string, corpo: unknown, chaveGuarda: string): Promise<unknown> {
  const nome = nomeDe(conta)
  const r = await chamarApiPaga(admin, { api: conta.api ?? 'foody', chave: chaveGuarda, loja }, async () => {
    const t = await token(conta)
    const res = await fetch(`${conta.baseUrl}${caminho}`, {
      method: metodo, headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const texto = await res.text()
    let j: unknown = null
    try { j = texto ? JSON.parse(texto) : null } catch { j = texto }
    if (!res.ok) {
      console.error(`[${conta.api ?? 'foody'}] ${metodo} ${caminho} → ${res.status}`)
      const msg = (j && typeof j === 'object' && 'message' in (j as Record<string, unknown>)) ? String((j as Record<string, unknown>).message) : ''
      throw new FoodyError(res.status === 401 || res.status === 403 ? `${nome} não autorizou (confira as credenciais).` : res.status === 404 ? `${nome} não atende este endereço ou não encontrou a entrega.` : res.status === 422 || res.status === 400 ? `${nome} recusou: ${msg || 'dados da entrega'}` : `${nome} respondeu ${res.status}.`, res.status, j)
    }
    return j
  })
  if (r.ok) return r.valor
  if (r.motivo === 'erro') throw new FoodyError(r.erro ?? `Não foi possível falar com ${nome}.`, 0)
  if (r.motivo === 'disparo') throw new FoodyError(`Muitas chamadas iguais à ${nome} em 1 minuto — bloqueadas por segurança. Aguarde.`, 429)
  if (r.motivo === 'limite') throw new FoodyError(`Limite diário de chamadas à ${nome} atingido. O suporte da Menuzia foi avisado.`, 429)
  throw new FoodyError('Sem contagem de uso no banco — chamada não feita.', 503)
}

export interface EnderecoOd { street: string; number: string; complement: string; district: string; city: string; state: string; postalCode: string; reference: string; latitude: number; longitude: number; country?: string }
export interface PedidoParaFoody {
  orderId: string; orderDisplayId: string; merchant: { id: string; name: string }
  pickup: EnderecoOd; delivery: EnderecoOd
  customerName: string; customerPhone: string
  totalOrderPrice: number; orderDeliveryFee: number
  items: { name: string; quantity: number }[]
  pagamento: { prepago: boolean; forma: 'pix' | 'cartao' | 'dinheiro'; valor: number }
  specialInstructions: string
}
const preco = (v: number) => ({ value: Math.round(v * 100) / 100, currency: 'BRL' })
const VEICULO = { type: ['MOTORBIKE_BAG', 'MOTORBIKE_BOX'], container: 'THERMIC' }

export interface CotacaoFoody { preco: number; pickupEtaMin: number | null; deliveryEtaMin: number | null; disponivel: boolean }

export async function cotarFoody(admin: SupabaseClient, loja: string, conta: ContaFoody, p: Omit<PedidoParaFoody, 'orderId' | 'orderDisplayId' | 'customerName' | 'customerPhone' | 'pagamento' | 'items'>, pedidoId: string): Promise<CotacaoFoody> {
  const corpo = {
    merchant: p.merchant, pickupAddress: { country: 'BR', ...p.pickup }, returnToMerchant: false, canCombine: false, deliveryAddress: { country: 'BR', ...p.delivery },
    vehicle: VEICULO, limitTimes: { orderCreatedAt: new Date().toISOString() }, totalOrderPrice: preco(p.totalOrderPrice), orderDeliveryFee: preco(p.orderDeliveryFee), totalWeight: 1, packageQuantity: 1, specialInstructions: p.specialInstructions,
  }
  const j = await chamar(admin, loja, conta, 'POST', '/v1/logistics/availability', corpo, `cotacao:${pedidoId}`) as Record<string, unknown> | null
  const dp = (j?.deliveryPrice as Record<string, unknown> | undefined)
  const pr = (dp?.price as Record<string, unknown> | undefined)
  const eta = (j?.ETAs as Record<string, unknown> | undefined) ?? (j?.etas as Record<string, unknown> | undefined)
  const valor = Number(pr?.value ?? dp?.value ?? 0)
  return { preco: Number.isFinite(valor) ? valor : 0, pickupEtaMin: eta?.pickupEtaInMinutes === undefined ? null : Number(eta.pickupEtaInMinutes), deliveryEtaMin: eta?.deliveryEtaInMinutes === undefined ? null : Number(eta.deliveryEtaInMinutes), disponivel: !!j }
}

export async function criarEntregaFoody(admin: SupabaseClient, loja: string, conta: ContaFoody, p: PedidoParaFoody): Promise<{ deliveryId: string; event: string | null; trackingUrl: string | null }> {
  const corpo = {
    orderId: p.orderId, orderDisplayId: p.orderDisplayId, merchant: p.merchant,
    pickupAddress: { country: 'BR', ...p.pickup }, notifyReadyForPickup: false, notifyPickup: true, notifyConclusion: true, returnToMerchant: false, canCombine: false, confirmationCodeRequired: false,
    deliveryAddress: { country: 'BR', ...p.delivery }, customerName: p.customerName.slice(0, 80), customerPhone: p.customerPhone,
    vehicle: VEICULO, limitTimes: { orderCreatedAt: new Date().toISOString() }, totalOrderPrice: preco(p.totalOrderPrice), orderDeliveryFee: preco(p.orderDeliveryFee), totalWeight: 1, packageQuantity: 1,
    items: p.items.map((i) => ({ name: i.name.slice(0, 120), quantity: i.quantity })), specialInstructions: p.specialInstructions.slice(0, 300),
    payments: p.pagamento.prepago ? { method: 'ONLINE' } : { method: 'OFFLINE', wirelessPos: p.pagamento.forma === 'cartao', offlineMethod: [{ type: p.pagamento.forma === 'dinheiro' ? 'CASH' : p.pagamento.forma === 'pix' ? 'PIX' : 'CREDIT_DEBIT', amount: preco(p.pagamento.valor) }] },
  }
  const j = await chamar(admin, loja, conta, 'POST', '/v1/logistics/delivery', corpo, `criar:${p.orderId}`) as Record<string, unknown> | null
  const deliveryId = String(j?.deliveryId ?? j?.id ?? '')
  if (!deliveryId) throw new FoodyError('A Foody não devolveu o número da entrega.', 502, j)
  return { deliveryId, event: (j?.event as string | undefined) ?? null, trackingUrl: (j?.deliveryDetailsURL as string | undefined) ?? null }
}

export async function cancelarEntregaFoody(admin: SupabaseClient, loja: string, conta: ContaFoody, orderId: string, motivo: string): Promise<void> {
  await chamar(admin, loja, conta, 'POST', `/v1/logistics/cancel/${encodeURIComponent(orderId)}`, { reason: motivo.slice(0, 200), cancellationCode: 'MERCHANT_CANCELLED' }, `cancelar:${orderId}`)
}

export async function prontoParaColetaFoody(admin: SupabaseClient, loja: string, conta: ContaFoody, orderId: string): Promise<void> {
  await chamar(admin, loja, conta, 'POST', `/v1/logistics/readyForPickup/${encodeURIComponent(orderId)}`, {}, `pronto:${orderId}`)
}

/** Assinatura do webhook de logística (spec: X-App-Signature = HMAC-SHA256 do corpo com o client secret; hex ou base64). */
export function assinaturaFoodyValida(corpoBruto: string, assinatura: string | null, clientSecret: string): boolean {
  if (!assinatura) return false
  const mac = createHmac('sha256', clientSecret).update(corpoBruto, 'utf8').digest()
  const dada = assinatura.trim()
  for (const c of [mac.toString('hex'), mac.toString('base64'), mac.toString('base64url')]) if (c.length === dada.length && timingSafeEqual(Buffer.from(c), Buffer.from(dada))) return true
  return false
}
