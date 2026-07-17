/**
 * Cliente da API do Nexta Delivery — operador logístico que implementa o padrão
 * Open Delivery (ABRASEL v1.7.0), módulo Logistics.
 *
 * SERVER-ONLY: recebe a config da loja (que carrega o client_secret) e nunca deve ser
 * importado em componente client. O browser fala com as rotas /api/admin/nexta/*.
 *
 * A URL base da API é a MESMA para todas as lojas (`NEXTA_BASE_URL`). O que muda por
 * estabelecimento é só o par client_id/client_secret (o Nexta emite um par por loja) e
 * o merchant_id (o identificador que a loja informa ao suporte do Nexta).
 *
 * Divergências conhecidas do backend do Nexta (Xano) em relação à spec, todas testadas
 * no sandbox em 2026-07-15 — ver docs/NEXTA-INTEGRACAO-PLANO.md §2:
 *  - /oauth/token não devolve `expires_in` ⇒ cache fixo de 50 min + retry em 401;
 *  - campos opcionais de endereço ausentes causam ERROR_FATAL "Unable to locate var"
 *    ⇒ mandamos sempre, mesmo vazios;
 *  - `vehicle.type` precisa ser array; string quebra o parse deles.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export {
  NEXTA_APP_ID,
  NEXTA_EVENTOS,
  NEXTA_EVENTOS_REPETIDOS,
  NEXTA_EVENTOS_TERMINAIS,
  motivoRejeicaoTexto,
  nextaEntregaAtiva,
  nextaEventoTexto,
  nextaEventoTom,
  type NextaEvento,
} from './nexta-eventos'

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface NextaPickup {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  latitude: number | null
  longitude: number | null
}

/**
 * URL base da API do Nexta — a mesma para todas as lojas. O Nexta expõe um único
 * backend (Xano); só as credenciais é que são por estabelecimento. Sem o fragmento
 * `#/` que a UI de docs do Xano acrescenta (ele viraria fragmento de URL e o path
 * nunca chegaria ao servidor → 405).
 */
export const NEXTA_BASE_URL = 'https://bck.nextadelivery.app/api:lZyx1NRE'

export interface NextaConfig {
  restauranteId: string
  ativo: boolean
  clientId: string
  clientSecret: string
  merchantId: string
  merchantName: string
  webhookToken: string
  pickup: NextaPickup
  vehicleType: string
  container: string
  containerSize: string
  pickupLimitMin: number
  deliveryLimitMin: number
  limitTimesAsDatetime: boolean
  pesoPadraoG: number
}

/** Endereço do cliente já resolvido (lat/lng podem ser null — cotamos mesmo assim). */
export interface NextaEntrega {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  latitude: number | null
  longitude: number | null
  /** Observações do pedido — viram `instructions` para o motoboy. */
  instrucoes: string
}

/** Dados do pedido que o payload precisa. Subconjunto de `Pedido` para manter isto puro. */
export interface NextaPedido {
  id: string
  numero: number
  clienteNome: string
  clienteTelefone: string
  formaPagamento: 'pix' | 'cartao' | 'dinheiro'
  trocoPara: number | null
  pago: boolean
  total: number
  taxaEntrega: number
  criadoEm: string
  itens: { nome: string; quantidade: number }[]
}

export interface CotacaoNexta {
  preco: number
  etaColetaMin: number | null
  etaEntregaMin: number | null
  etaColetaEm: string | null
  etaEntregaEm: string | null
  /** Resposta crua da /availability — guardada em nexta_entregas.cotacao para auditoria. */
  bruto: unknown
}

export interface CriacaoNexta {
  deliveryId: string | null
  evento: string
  rejeitarApos: string | null
  bruto: unknown
}

export interface DetalhesNexta {
  deliveryId: string | null
  evento: string | null
  preco: number | null
  entregador: { nome: string; telefone: string; fotoUrl: string } | null
  trackingUrl: string | null
  bruto: unknown
}

/** Erro de negócio da API do Nexta — `mensagem` é legível pro lojista, `bruto` vai pro log. */
export class NextaError extends Error {
  readonly status: number
  readonly bruto: unknown

  constructor(mensagem: string, status: number, bruto: unknown) {
    super(mensagem)
    this.name = 'NextaError'
    this.status = status
    this.bruto = bruto
  }
}

// ── Enums do padrão ──────────────────────────────────────────────────────────
// Os enums de evento moram em `lib/nexta-eventos.ts` (client-safe) e são reexportados
// aqui pra quem já importa este módulo no servidor.

export type NextaMotivoCancelamento =
  | 'PROBLEM_AT_MERCHANT'
  | 'CONSUMER_CANCELLATION_REQUESTED'
  | 'NO_SHOW'
  | 'HIGH_ACCEPTANCE_TIME'
  | 'INCORRECT_ORDER_OR_PRODUCT_PICKUP'
  | 'PROBLEM_RESOLUTION'
  | 'DISCOMBINE_ORDER'
  | 'OTHER'

export type NextaAcaoCancelamento = 'RETURN_TO_STORE' | 'CANCEL_DELIVERY'

// ── Helpers puros ────────────────────────────────────────────────────────────

/** RFC3339 em UTC sem milissegundos — formato que o Nexta aceita. */
export function isoNexta(data: Date): string {
  return data.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Telefone no formato internacional (+55DDNNNNNNNNN). O Nexta repassa esse número
 * pro motoboy ligar pro cliente.
 */
export function telefoneNexta(telefone: string | null | undefined): string {
  const digitos = String(telefone ?? '').replace(/\D/g, '')
  if (!digitos) return ''
  return digitos.startsWith('55') ? `+${digitos}` : `+55${digitos}`
}

/** UF → código ISO 3166-2 que a spec exige (`BR-SP`). String vazia se a loja não configurou. */
function estadoNexta(uf: string): string {
  const limpo = uf.trim().toUpperCase()
  return limpo ? `BR-${limpo}` : ''
}

const PAGAMENTO_NEXTA: Record<NextaPedido['formaPagamento'], string> = {
  dinheiro: 'CASH',
  cartao: 'CREDIT_DEBIT',
  pix: 'PIX',
}

/**
 * Endereço Menuzia → `AddressLogistics` do Open Delivery.
 *
 * Todos os campos opcionais (`complement`, `reference`, `instructions`) vão sempre,
 * mesmo vazios: o backend do Nexta quebra com "Unable to locate var" quando faltam.
 */
function montarEndereco(e: {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  cep: string
  latitude: number | null
  longitude: number | null
  instrucoes?: string
}) {
  const endereco: Record<string, unknown> = {
    country: 'BR',
    state: estadoNexta(e.uf),
    city: e.cidade.trim(),
    district: e.bairro.trim(),
    street: e.rua.trim(),
    number: e.numero.trim(),
    postalCode: e.cep.replace(/\D/g, ''),
    complement: e.complemento?.trim() ?? '',
    reference: '',
    instructions: e.instrucoes?.trim() ?? '',
  }
  // lat/lng só entram quando existem de verdade — mandar 0 colocaria o pino no Atlântico.
  if (e.latitude !== null && e.longitude !== null) {
    endereco.latitude = e.latitude
    endereco.longitude = e.longitude
  }
  return endereco
}

/**
 * `limitTimes` conforme a spec (minutos) ou como datetime, dependendo da flag de
 * compatibilidade da loja — o sandbox rejeitou minutos pedindo timestamp, e a
 * homologação (Fase 4) vai definir qual é o formato oficial.
 */
function montarLimitTimes(cfg: NextaConfig, agora: Date) {
  const orderCreatedAt = isoNexta(agora)
  if (!cfg.limitTimesAsDatetime) {
    return { pickupLimit: cfg.pickupLimitMin, deliveryLimit: cfg.deliveryLimitMin, orderCreatedAt }
  }
  return {
    pickupLimit: isoNexta(new Date(agora.getTime() + cfg.pickupLimitMin * 60_000)),
    deliveryLimit: isoNexta(new Date(agora.getTime() + cfg.deliveryLimitMin * 60_000)),
    orderCreatedAt,
  }
}

/** Corpo da cotação (`/v1/logistics/availability`). Puro — exportado pros testes. */
export function montarPayloadCotacao(
  cfg: NextaConfig,
  entrega: NextaEntrega,
  valores: { totalPedido: number; taxaEntrega: number },
  agora: Date
): Record<string, unknown> {
  return {
    merchant: { id: cfg.merchantId, name: cfg.merchantName },
    pickupAddress: montarEndereco(cfg.pickup),
    deliveryAddress: montarEndereco(entrega),
    returnToMerchant: false,
    canCombine: true,
    vehicle: { type: [cfg.vehicleType], container: cfg.container, containerSize: cfg.containerSize },
    limitTimes: montarLimitTimes(cfg, agora),
    totalOrderPrice: { value: valores.totalPedido, currency: 'BRL' },
    orderDeliveryFee: { value: valores.taxaEntrega, currency: 'BRL' },
    totalWeight: cfg.pesoPadraoG,
  }
}

/**
 * Corpo da criação de entrega (`/v1/logistics/delivery`) — a cotação + dados do
 * pedido/cliente/pagamento. Puro — exportado pros testes.
 *
 * `orderId` é gerado por nós (é o id da linha em `nexta_entregas`) e é o que aparece
 * como "ID da Integração" no painel do Nexta.
 */
export function montarPayloadEntrega(
  cfg: NextaConfig,
  pedido: NextaPedido,
  entrega: NextaEntrega,
  orderId: string,
  agora: Date
): Record<string, unknown> {
  const base = montarPayloadCotacao(cfg, entrega, { totalPedido: pedido.total, taxaEntrega: pedido.taxaEntrega }, agora)

  // Pix/cartão já pagos na vitrine = ONLINE (motoboy não recebe nada). Senão o motoboy
  // cobra na entrega, e o troco viaja em `payments.change` — é assim que o entregador
  // do Nexta sabe pra quanto levar troco.
  const payments: Record<string, unknown> = pedido.pago
    ? { method: 'ONLINE' }
    : {
        method: 'OFFLINE',
        offlineMethod: [{ type: PAGAMENTO_NEXTA[pedido.formaPagamento], amount: pedido.total }],
      }
  if (!pedido.pago && pedido.formaPagamento === 'dinheiro' && pedido.trocoPara !== null) {
    payments.change = { value: pedido.trocoPara, currency: 'BRL' }
  }

  return {
    ...base,
    orderId,
    orderDisplayId: `#${pedido.numero}`,
    customerName: pedido.clienteNome || 'Cliente',
    customerPhone: telefoneNexta(pedido.clienteTelefone),
    payments,
    items: pedido.itens.map((i) => ({ name: i.nome, quantity: i.quantidade })),
    // Usamos o botão "Pronto p/ coleta" do painel; coleta e conclusão quem confirma é o
    // próprio Nexta (chegam por webhook), então não prometemos notificar.
    notifyReadyForPickup: true,
    notifyPickup: false,
    notifyConclusion: false,
    confirmationCodeRequired: false,
  }
}

/**
 * Valida o header `X-App-Signature`: HMAC-SHA256 hex do corpo BRUTO, chave = client_secret
 * da loja. Comparação em tempo constante. Puro — exportado pros testes.
 */
export function validarAssinaturaWebhook(rawBody: string, assinatura: string | null, clientSecret: string): boolean {
  if (!assinatura || !clientSecret) return false
  const esperado = createHmac('sha256', clientSecret).update(rawBody, 'utf8').digest('hex')
  const recebido = assinatura.trim().toLowerCase()
  if (recebido.length !== esperado.length) return false
  try {
    return timingSafeEqual(Buffer.from(esperado, 'utf8'), Buffer.from(recebido, 'utf8'))
  } catch {
    return false
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const TOKEN_TTL_MS = 50 * 60 * 1000 // o Nexta não manda expires_in; 50 min com folga
const TIMEOUT_MS = 15_000

const tokenCache = new Map<string, { token: string; expiraEm: number }>()

/** Invalida o token em cache — chamado no retry de 401 e ao salvar credenciais novas. */
export function limparTokenNexta(restauranteId: string) {
  tokenCache.delete(restauranteId)
}

function urlNexta(path: string): string {
  // Tira barra/fragmento no fim por robustez, mesmo a constante já vindo limpa.
  return `${NEXTA_BASE_URL.replace(/[/#]+$/, '')}${path}`
}

/** Extrai uma mensagem legível do corpo de erro do Nexta (que varia bastante de forma). */
function mensagemErro(status: number, corpo: unknown): string {
  if (typeof corpo === 'string' && corpo.trim()) return corpo.trim()
  if (corpo && typeof corpo === 'object') {
    const o = corpo as Record<string, unknown>
    for (const chave of ['message', 'error', 'detail', 'description']) {
      const v = o[chave]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  if (status === 401 || status === 403) return 'Credenciais recusadas pelo Nexta.'
  if (status >= 500) return 'O Nexta respondeu com um erro interno. Tente novamente em instantes.'
  return `O Nexta respondeu ${status}.`
}

async function lerCorpo(res: Response): Promise<unknown> {
  const texto = await res.text()
  if (!texto) return null
  try {
    return JSON.parse(texto)
  } catch {
    return texto
  }
}

/** Token OAuth2 client_credentials da loja, com cache em memória. */
export async function obterToken(cfg: NextaConfig, forcarRenovacao = false): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new NextaError('Integração Nexta sem credenciais configuradas.', 0, null)
  }

  const cache = tokenCache.get(cfg.restauranteId)
  if (!forcarRenovacao && cache && cache.expiraEm > Date.now()) return cache.token

  let res: Response
  try {
    res = await fetch(urlNexta('/oauth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new NextaError('Não foi possível falar com o Nexta. Verifique a URL base e a conexão.', 0, null)
  }

  const corpo = await lerCorpo(res)
  if (!res.ok) throw new NextaError(mensagemErro(res.status, corpo), res.status, corpo)

  const token = (corpo as { access_token?: string } | null)?.access_token
  if (!token) throw new NextaError('O Nexta autenticou mas não devolveu um token.', res.status, corpo)

  tokenCache.set(cfg.restauranteId, { token, expiraEm: Date.now() + TOKEN_TTL_MS })
  return token
}

/**
 * Chamada autenticada. Em 401 renova o token uma única vez e repete — o Nexta não diz
 * quando o token expira, então descobrir pelo 401 é a única estratégia possível.
 */
async function chamar(cfg: NextaConfig, path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
  const executar = async (token: string): Promise<Response> => {
    try {
      return await fetch(urlNexta(path), {
        method: init.method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new NextaError('Não foi possível falar com o Nexta. Verifique a conexão.', 0, null)
    }
  }

  let res = await executar(await obterToken(cfg))
  if (res.status === 401) {
    limparTokenNexta(cfg.restauranteId)
    res = await executar(await obterToken(cfg, true))
  }

  const corpo = await lerCorpo(res)
  if (!res.ok) {
    console.error(`[nexta] ${init.method} ${path} → ${res.status}`, JSON.stringify(corpo))
    throw new NextaError(mensagemErro(res.status, corpo), res.status, corpo)
  }
  return corpo
}

// ── Operações ────────────────────────────────────────────────────────────────

interface RespostaCotacao {
  deliveryPrice?: { price?: { value?: number } }
  ETAs?: {
    pickupEtaInMinutes?: number
    deliveryEtaInMinutes?: number
    pickupEtaDatetime?: string
    deliveryEtaDatetime?: string
  }
}

const numeroOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const textoOuNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Cotação de preço e ETA. Não cria nada no Nexta — pode ser chamada à vontade. */
export async function cotarEntrega(
  cfg: NextaConfig,
  entrega: NextaEntrega,
  valores: { totalPedido: number; taxaEntrega: number },
  agora: Date = new Date()
): Promise<CotacaoNexta> {
  const payload = montarPayloadCotacao(cfg, entrega, valores, agora)
  const bruto = (await chamar(cfg, '/v1/logistics/availability', { method: 'POST', body: payload })) as RespostaCotacao | null

  const preco = numeroOuNull(bruto?.deliveryPrice?.price?.value)
  if (preco === null) throw new NextaError('O Nexta não devolveu um preço para essa entrega.', 200, bruto)

  return {
    preco,
    etaColetaMin: numeroOuNull(bruto?.ETAs?.pickupEtaInMinutes),
    etaEntregaMin: numeroOuNull(bruto?.ETAs?.deliveryEtaInMinutes),
    etaColetaEm: textoOuNull(bruto?.ETAs?.pickupEtaDatetime),
    etaEntregaEm: textoOuNull(bruto?.ETAs?.deliveryEtaDatetime),
    bruto,
  }
}

/**
 * Solicita a entrega. Responde 202 com `event: PENDING` — o aceite/rejeição chega
 * DEPOIS, por webhook (ACCEPTED/REJECTED).
 */
export async function criarEntrega(
  cfg: NextaConfig,
  pedido: NextaPedido,
  entrega: NextaEntrega,
  orderId: string,
  agora: Date = new Date()
): Promise<CriacaoNexta> {
  const payload = montarPayloadEntrega(cfg, pedido, entrega, orderId, agora)
  const bruto = (await chamar(cfg, '/v1/logistics/delivery', { method: 'POST', body: payload })) as {
    deliveryId?: string
    event?: string
    completion?: { rejectAfter?: string }
  } | null

  return {
    deliveryId: textoOuNull(bruto?.deliveryId),
    evento: textoOuNull(bruto?.event) ?? 'PENDING',
    rejeitarApos: textoOuNull(bruto?.completion?.rejectAfter),
    bruto,
  }
}

/** Avisa o Nexta que o pedido está pronto para ser coletado. */
export async function avisarPronto(cfg: NextaConfig, orderId: string): Promise<void> {
  await chamar(cfg, `/v1/logistics/readyForPickup/${orderId}`, { method: 'POST', body: {} })
}

/** Cancela a entrega. `additionalCharges` indica se o Nexta vai cobrar pelo cancelamento. */
export async function cancelarEntrega(
  cfg: NextaConfig,
  orderId: string,
  motivo: NextaMotivoCancelamento,
  acao: NextaAcaoCancelamento,
  mensagem = ''
): Promise<{ additionalCharges: boolean }> {
  const bruto = (await chamar(cfg, `/v1/logistics/cancel/${orderId}`, {
    method: 'POST',
    body: { reason: motivo, action: acao, message: mensagem },
  })) as { additionalCharges?: boolean } | null

  return { additionalCharges: bruto?.additionalCharges === true }
}

/**
 * Detalhes da entrega. USO PONTUAL — a spec proíbe usar como tracking em loop (risco de
 * bloqueio). Serve só de reconciliação quando um webhook se perde.
 */
export async function consultarEntrega(cfg: NextaConfig, orderId: string): Promise<DetalhesNexta> {
  const bruto = (await chamar(cfg, `/v1/logistics/delivery/${orderId}`, { method: 'GET' })) as {
    deliveryId?: string
    event?: { type?: string } | string
    deliveryPrice?: { price?: { value?: number } }
    deliveryPerson?: { name?: string; phone?: string; pictureURL?: string }
    externalTrackingURL?: string
  } | null

  const evento = typeof bruto?.event === 'string' ? bruto.event : textoOuNull(bruto?.event?.type)
  const pessoa = bruto?.deliveryPerson

  return {
    deliveryId: textoOuNull(bruto?.deliveryId),
    evento,
    preco: numeroOuNull(bruto?.deliveryPrice?.price?.value),
    entregador: pessoa?.name
      ? { nome: pessoa.name, telefone: pessoa.phone ?? '', fotoUrl: pessoa.pictureURL ?? '' }
      : null,
    trackingUrl: textoOuNull(bruto?.externalTrackingURL),
    bruto,
  }
}
