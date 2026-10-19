import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'
import { tokenIfood } from '@/lib/canais/ifood/cliente'
import type { ConfigCanal } from '@/lib/canais/config'

/**
 * Entregador do iFood "Sob Demanda" para pedidos de FORA do iFood (Etapa 3, 19/10). API PAGA pela loja (a corrida
 * é cobrada na conta iFood do restaurante + 4% do pedido, segundo o iFood) → só este arquivo fala com o módulo
 * shipping, sempre por `chamarApiPaga` (api 'ifood_entrega': trava de disparo, limite diário LIMITE_IFOOD_ENTREGA_DIA,
 * alerta). O token é o mesmo da integração de pedidos do iFood (lib/canais/ifood/cliente.ts, gratuito).
 *
 * Caminhos conforme a documentação pública do módulo Shipping (developer.ifood.com.br › Shipping › pedidos de fora):
 *   GET  /shipping/v1.0/merchants/{merchantId}/deliveryAvailabilities?latitude&longitude   → cotação (id, prazo, valores)
 *   POST /shipping/v1.0/merchants/{merchantId}/orders                                       → cria o pedido/entrega
 *   POST /order/v1.0/orders/{id}/requestCancellation                                        → cancela
 * ⚠️ Pendente de homologação com credencial real: os nomes dos campos foram tirados da documentação e podem precisar de
 * ajuste fino no primeiro teste (a loja piloto é a Menuzia). Nenhuma chamada no navegador, em render ou intervalo.
 */
const BASE = 'https://merchant-api.ifood.com.br'
const TIMEOUT_MS = 15_000

export class IfoodEntregaError extends Error { constructor(m: string, readonly status: number, readonly corpo: unknown = null) { super(m); this.name = 'IfoodEntregaError' } }

export interface CotacaoIfoodEntrega { quoteId: string; preco: number; distanciaM: number | null; expiraEm: string | null; prazoMin: number | null }

export interface EntregaIfoodParaCriar {
  quoteId: string
  numero: number
  cliente: { nome: string; telefone: string; documento?: string | null }
  endereco: { rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string; referencia: string; lat: number; lng: number }
  itens: { nome: string; quantidade: number; precoUnitario: number; codigoExterno?: string | null }[]
  total: number
  pagamento: { forma: 'pix' | 'cartao' | 'dinheiro'; prepago: boolean; trocoPara: number | null }
  observacao: string
}

async function chamar(admin: SupabaseClient, loja: string, cfg: ConfigCanal, metodo: 'GET' | 'POST', caminho: string, corpo: unknown, chaveGuarda: string): Promise<unknown> {
  const r = await chamarApiPaga(admin, { api: 'ifood_entrega', chave: chaveGuarda, loja }, async () => {
    const token = await tokenIfood(admin, cfg)
    const res = await fetch(`${BASE}${caminho}`, {
      method: metodo, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const t = await res.text()
    let j: unknown = null
    try { j = t ? JSON.parse(t) : null } catch { j = t }
    if (!res.ok) {
      console.error(`[ifood-entrega] ${metodo} ${caminho} → ${res.status}`)
      const msg = (j && typeof j === 'object' && 'message' in (j as Record<string, unknown>)) ? String((j as Record<string, unknown>).message) : ''
      throw new IfoodEntregaError(res.status === 401 ? 'iFood não autorizou (conecte a loja em Integrações › iFood).' : res.status === 404 ? 'O iFood não encontrou a loja ou não oferece entregador aqui.' : res.status === 422 || res.status === 400 ? `iFood recusou: ${msg || 'dados da entrega'}` : `iFood respondeu ${res.status}.`, res.status, j)
    }
    return j
  })
  if (r.ok) return r.valor
  if (r.motivo === 'erro') throw new IfoodEntregaError(r.erro ?? 'Não foi possível falar com o iFood.', 0)
  if (r.motivo === 'disparo') throw new IfoodEntregaError('Muitas chamadas iguais ao iFood em 1 minuto — bloqueadas por segurança. Aguarde.', 429)
  if (r.motivo === 'limite') throw new IfoodEntregaError('Limite diário de chamadas ao entregador do iFood atingido. O suporte da Menuzia foi avisado.', 429)
  throw new IfoodEntregaError('Sem contagem de uso no banco — chamada não feita.', 503)
}

const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null }

/** Cotação: o iFood diz se atende o endereço e por quanto. Não cria nada. */
export async function cotarIfoodEntrega(admin: SupabaseClient, loja: string, cfg: ConfigCanal, merchantId: string, destino: { lat: number; lng: number }, pedidoId: string): Promise<CotacaoIfoodEntrega> {
  const q = new URLSearchParams({ latitude: String(destino.lat), longitude: String(destino.lng) })
  const j = await chamar(admin, loja, cfg, 'GET', `/shipping/v1.0/merchants/${encodeURIComponent(merchantId)}/deliveryAvailabilities?${q}`, undefined, `cotacao:${pedidoId}`) as Record<string, unknown> | Record<string, unknown>[] | null
  const r = (Array.isArray(j) ? j[0] : j) ?? {}
  const quote = (r.quote as Record<string, unknown> | undefined) ?? r
  const id = String(quote.id ?? r.id ?? '')
  if (!id) throw new IfoodEntregaError('O iFood não devolveu uma cotação para este endereço.', 422, j)
  const valores = (quote.deliveryFee as Record<string, unknown> | undefined) ?? quote
  const preco = num(valores.netValue ?? valores.grossValue ?? valores.value ?? quote.price) ?? 0
  const tempo = (quote.deliveryTime as Record<string, unknown> | undefined)
  return { quoteId: id, preco, distanciaM: num(quote.distance) === null ? null : Math.round((num(quote.distance) as number) * (Number(quote.distance) < 100 ? 1000 : 1)), expiraEm: (quote.expirationAt as string | undefined) ?? null, prazoMin: tempo ? Math.round(((num(tempo.max) ?? num(tempo.min) ?? 0) as number) / 60) : null }
}

/** Cria a entrega (pedido externo no iFood) a partir da cotação. Devolve o id do pedido iFood (externo_id da corrida). */
export async function criarEntregaIfood(admin: SupabaseClient, loja: string, cfg: ConfigCanal, merchantId: string, e: EntregaIfoodParaCriar): Promise<{ id: string; status: string | null }> {
  const telefone = e.cliente.telefone.replace(/\D/g, '')
  const corpo = {
    quoteId: e.quoteId, displayId: String(e.numero), externalCode: String(e.numero),
    customer: { name: e.cliente.nome.slice(0, 80), phone: { countryCode: '55', number: telefone.startsWith('55') ? telefone.slice(2) : telefone }, ...(e.cliente.documento ? { documentNumber: e.cliente.documento } : {}) },
    delivery: { deliveryAddress: { streetName: e.endereco.rua, streetNumber: e.endereco.numero, complement: e.endereco.complemento, neighborhood: e.endereco.bairro, city: e.endereco.cidade, state: e.endereco.estado, postalCode: e.endereco.cep, reference: e.endereco.referencia, coordinates: { latitude: e.endereco.lat, longitude: e.endereco.lng } } },
    items: e.itens.map((i, index) => ({ index, name: i.nome.slice(0, 120), quantity: i.quantidade, unitPrice: i.precoUnitario, price: Math.round(i.precoUnitario * i.quantidade * 100) / 100, ...(i.codigoExterno ? { externalCode: i.codigoExterno } : {}) })),
    total: { orderAmount: e.total },
    payments: { prepaid: e.pagamento.prepago ? e.total : 0, pending: e.pagamento.prepago ? 0 : e.total, methods: [{ method: e.pagamento.forma === 'dinheiro' ? 'CASH' : e.pagamento.forma === 'pix' ? 'PIX' : 'CREDIT', type: e.pagamento.prepago ? 'ONLINE' : 'OFFLINE', value: e.total, prepaid: e.pagamento.prepago, ...(e.pagamento.trocoPara ? { cash: { changeFor: e.pagamento.trocoPara } } : {}) }] },
    ...(e.observacao ? { extraInfo: e.observacao.slice(0, 300) } : {}),
  }
  const j = await chamar(admin, loja, cfg, 'POST', `/shipping/v1.0/merchants/${encodeURIComponent(merchantId)}/orders`, corpo, `criar:${e.quoteId}`) as Record<string, unknown> | null
  const id = String(j?.id ?? j?.orderId ?? '')
  if (!id) throw new IfoodEntregaError('O iFood não devolveu o número da entrega.', 502, j)
  return { id, status: (j?.status as string | undefined) ?? null }
}

export async function cancelarEntregaIfood(admin: SupabaseClient, loja: string, cfg: ConfigCanal, orderId: string): Promise<void> {
  await chamar(admin, loja, cfg, 'POST', `/order/v1.0/orders/${encodeURIComponent(orderId)}/requestCancellation`, { reason: 'Cancelado pela loja', cancellationCode: '501' }, `cancelar:${orderId}`)
}
