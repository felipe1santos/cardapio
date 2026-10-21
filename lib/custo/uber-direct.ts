import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'

/**
 * Uber Direct (entregador da Uber para pedidos de fora da Uber), 21/10/2026. Docs oficiais em
 * developer.uber.com/docs/deliveries. Cada loja tem a PRÓPRIA conta (direct.uber.com › Developer): customer_id,
 * client_id, client_secret e a signing key do webhook. Nós chamamos:
 *   POST https://auth.uber.com/oauth/v2/token (client_credentials, scope eats.deliveries; token de 30 dias)
 *   POST /v1/customers/{customer_id}/delivery_quotes           (preço em centavos, vale ~15 min)
 *   POST /v1/customers/{customer_id}/deliveries                (cria; em teste, Robo Courier anda sozinho)
 *   POST /v1/customers/{customer_id}/deliveries/{id}/cancel
 *   GET  /v1/customers/{customer_id}/deliveries/{id}
 * e recebemos event.delivery_status / event.courier_update em app/api/entregas/uber/webhook/[token]
 * (x-uber-signature = HMAC-SHA256 hex do corpo bruto com a signing key). API PAGA pela loja → só este arquivo fala com
 * ela, por `chamarApiPaga` (api 'uber', LIMITE_UBER_DIA).
 */
const API = 'https://api.uber.com'
const TOKEN_URL = 'https://auth.uber.com/oauth/v2/token'
const TIMEOUT_MS = 15_000
const tokens = new Map<string, { token: string; expira: number }>()

export class UberError extends Error { constructor(m: string, readonly status: number, readonly codigo: string | null = null) { super(m); this.name = 'UberError' } }

export interface ContaUber { customerId: string; clientId: string; clientSecret: string; teste: boolean }

/** Pede o token (cache até 1 h antes de vencer). Exportado para o "Testar conexão". */
export async function tokenUber(conta: ContaUber): Promise<string> {
  const chave = conta.clientId
  const c = tokens.get(chave)
  if (c && c.expira > Date.now()) return c.token
  const corpo = new URLSearchParams({ client_id: conta.clientId, client_secret: conta.clientSecret, grant_type: 'client_credentials', scope: 'eats.deliveries' })
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new UberError(res.status === 401 || res.status === 400 ? 'A Uber recusou o Client ID / Client Secret.' : `Uber (token) respondeu ${res.status}.`, res.status)
  const j = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!j.access_token) throw new UberError('A Uber não devolveu o token.', 502)
  tokens.set(chave, { token: j.access_token, expira: Date.now() + Math.max(300, Number(j.expires_in ?? 3600) - 3600) * 1000 })
  return j.access_token
}

/** Código de erro da Uber → mensagem para o dono. Puro. */
export function mensagemErroUber(status: number, codigo: string, mensagem: string): string {
  const c = (codigo || '').toLowerCase()
  if (/undeliverable|out_of_range|unknown_location|outside|not_serviced|service_area/.test(c)) return 'A Uber Direct não atende sua cidade (ou este endereço) agora.'
  if (/couriers?_busy|limited_couriers/.test(c)) return 'Sem entregadores da Uber disponíveis agora. Tente de novo em alguns minutos.'
  if (/expired/.test(c)) return 'A cotação da Uber venceu. Cote de novo.'
  if (status === 401 || status === 403) return 'A Uber não autorizou (confira Customer ID, Client ID e Client Secret).'
  if (status === 404) return 'A Uber não encontrou a conta ou a entrega (confira o Customer ID).'
  if (status === 400 || status === 422) return `A Uber recusou: ${mensagem || c || 'dados da entrega'}`
  return `A Uber respondeu ${status}.`
}

async function chamar(admin: SupabaseClient, loja: string, conta: ContaUber, metodo: 'GET' | 'POST', caminho: string, corpo: unknown, chaveGuarda: string): Promise<Record<string, unknown>> {
  const r = await chamarApiPaga(admin, { api: 'uber', chave: chaveGuarda, loja }, async () => {
    const t = await tokenUber(conta)
    const res = await fetch(`${API}/v1/customers/${encodeURIComponent(conta.customerId)}${caminho}`, {
      method: metodo, headers: { Authorization: `Bearer ${t}`, Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const texto = await res.text()
    let j: Record<string, unknown> = {}
    try { j = texto ? JSON.parse(texto) as Record<string, unknown> : {} } catch { j = {} }
    if (!res.ok) {
      console.error(`[uber] ${metodo} ${caminho.split('/').slice(0, 2).join('/')} → ${res.status} ${String(j.code ?? '')}`)
      throw new UberError(mensagemErroUber(res.status, String(j.code ?? ''), String(j.message ?? '')), res.status, String(j.code ?? '') || null)
    }
    return j
  })
  if (r.ok) return r.valor
  if (r.motivo === 'erro') throw new UberError(r.erro ?? 'Não foi possível falar com a Uber.', 0)
  if (r.motivo === 'disparo') throw new UberError('Muitas chamadas iguais à Uber em 1 minuto — bloqueadas por segurança. Aguarde.', 429)
  if (r.motivo === 'limite') throw new UberError('Limite diário de chamadas à Uber atingido. O suporte da Menuzia foi avisado.', 429)
  throw new UberError('Sem contagem de uso no banco — chamada não feita.', 503)
}

export interface EnderecoUber { rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string; lat: number; lng: number }

/** Endereço no formato da Uber: um JSON EM TEXTO com street_address [linha1, linha2]. Puro. */
export function enderecoUber(e: EnderecoUber): string {
  const linha1 = [e.rua, e.numero].filter(Boolean).join(', ')
  const linha2 = [e.complemento, e.bairro].filter(Boolean).join(' — ')
  return JSON.stringify({ street_address: [linha1, linha2].filter(Boolean), city: e.cidade, state: e.estado, zip_code: e.cep.replace(/\D/g, ''), country: 'BR' })
}

/** Telefone brasileiro em E.164 (+55…). Vazio se não der para montar. Puro. */
export function telefoneE164(tel: string): string {
  const d = (tel || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('55') && d.length >= 12) return `+${d}`
  if (d.length === 10 || d.length === 11) return `+55${d}`
  return `+${d}`
}

const centavos = (v: number) => Math.round(v * 100)

export interface CotacaoUber { quoteId: string; preco: number; expiraEm: string | null; prazoMin: number | null; moeda: string }

export async function cotarUber(admin: SupabaseClient, loja: string, conta: ContaUber, p: { origem: EnderecoUber; destino: EnderecoUber; telefoneLoja: string; telefoneCliente: string; valorPedido: number; lojaId: string }, pedidoId: string): Promise<CotacaoUber> {
  const j = await chamar(admin, loja, conta, 'POST', '/delivery_quotes', {
    pickup_address: enderecoUber(p.origem), dropoff_address: enderecoUber(p.destino),
    pickup_latitude: p.origem.lat, pickup_longitude: p.origem.lng, dropoff_latitude: p.destino.lat, dropoff_longitude: p.destino.lng,
    pickup_phone_number: telefoneE164(p.telefoneLoja), dropoff_phone_number: telefoneE164(p.telefoneCliente),
    manifest_total_value: centavos(p.valorPedido), external_store_id: p.lojaId,
  }, `cotacao:${pedidoId}`)
  const quoteId = String(j.id ?? '')
  if (!quoteId) throw new UberError('A Uber não devolveu a cotação.', 502)
  return { quoteId, preco: Number(j.fee ?? 0) / 100, expiraEm: (j.expires as string | undefined) ?? null, prazoMin: j.duration === undefined ? null : Number(j.duration), moeda: String(j.currency ?? 'brl').toUpperCase() }
}

export interface EntregaParaUber {
  quoteId: string; pedidoId: string; numero: number
  loja: { nome: string; telefone: string; endereco: EnderecoUber }
  cliente: { nome: string; telefone: string; endereco: EnderecoUber; referencia: string }
  itens: { nome: string; quantidade: number }[]; total: number; observacao: string
}

export async function criarEntregaUber(admin: SupabaseClient, loja: string, conta: ContaUber, p: EntregaParaUber): Promise<{ id: string; status: string; trackingUrl: string | null; preco: number | null }> {
  const j = await chamar(admin, loja, conta, 'POST', '/deliveries', {
    quote_id: p.quoteId, external_id: p.pedidoId,
    pickup_name: p.loja.nome.slice(0, 80), pickup_address: enderecoUber(p.loja.endereco), pickup_phone_number: telefoneE164(p.loja.telefone),
    pickup_latitude: p.loja.endereco.lat, pickup_longitude: p.loja.endereco.lng, pickup_notes: `Pedido #${p.numero}`,
    dropoff_name: p.cliente.nome.slice(0, 80) || 'Cliente', dropoff_address: enderecoUber(p.cliente.endereco), dropoff_phone_number: telefoneE164(p.cliente.telefone),
    dropoff_latitude: p.cliente.endereco.lat, dropoff_longitude: p.cliente.endereco.lng, dropoff_notes: [p.cliente.referencia, p.observacao].filter(Boolean).join(' · ').slice(0, 280),
    manifest_items: p.itens.slice(0, 50).map((i) => ({ name: i.nome.slice(0, 100), quantity: Math.max(1, Math.round(i.quantidade)), size: 'small' })),
    manifest_total_value: centavos(p.total), manifest_reference: `Pedido #${p.numero}`, undeliverable_action: 'return',
    // Conta de teste (live_mode false): o Robo Courier da Uber faz a corrida inteira sozinho, um passo a cada ~30 s.
    ...(conta.teste ? { test_specifications: { robo_courier_specification: { mode: 'auto' } } } : {}),
  }, `criar:${p.pedidoId}`)
  const id = String(j.id ?? '')
  if (!id) throw new UberError('A Uber não devolveu o número da entrega.', 502)
  return { id, status: String(j.status ?? 'pending'), trackingUrl: (j.tracking_url as string | undefined) ?? null, preco: j.fee === undefined ? null : Number(j.fee) / 100 }
}

export async function cancelarEntregaUber(admin: SupabaseClient, loja: string, conta: ContaUber, deliveryId: string): Promise<void> {
  await chamar(admin, loja, conta, 'POST', `/deliveries/${encodeURIComponent(deliveryId)}/cancel`, {}, `cancelar:${deliveryId}`)
}

/** Status da entrega na Uber → status da corrida (vocabulário da Lalamove). Puro. */
export function statusDeUber(status: string): string | null {
  switch ((status || '').toLowerCase()) {
    case 'pending': return 'ASSIGNING_DRIVER'
    case 'pickup': return 'ON_GOING'
    case 'pickup_complete': case 'dropoff': return 'PICKED_UP'
    case 'delivered': return 'COMPLETED'
    case 'canceled': case 'returned': return 'CANCELED'
    default: return null
  }
}

/** x-uber-signature: HMAC-SHA256 em hex do corpo BRUTO com a signing key do webhook. */
export function assinaturaUberValida(corpoBruto: string, assinatura: string | null, signingKey: string): boolean {
  if (!assinatura || !signingKey) return false
  const esperada = createHmac('sha256', signingKey).update(corpoBruto, 'utf8').digest('hex')
  const dada = assinatura.trim().toLowerCase()
  return esperada.length === dada.length && timingSafeEqual(Buffer.from(esperada), Buffer.from(dada))
}
