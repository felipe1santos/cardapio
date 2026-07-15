import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextaConfig } from '@/lib/nexta'
import { nextaEntregaAtiva } from '@/lib/nexta-eventos'

/**
 * Acesso a `nexta_config` e `nexta_entregas`.
 *
 * `nexta_config` só é legível pelo service_role (a migration 0042 não dá policy de RLS
 * para `authenticated`, porque a tabela guarda o client_secret) — as funções de config
 * aqui rodam sempre em route handler. Já `nexta_entregas` tem policy de select por
 * tenant, então as funções de leitura servem tanto ao painel quanto ao servidor.
 *
 * Importa só TIPOS de `lib/nexta.ts` (que puxa `node:crypto`) para continuar
 * importável do client.
 */

// ── Config ───────────────────────────────────────────────────────────────────

interface ConfigRow {
  restaurante_id: string
  ativo: boolean
  base_url: string
  client_id: string
  client_secret: string
  merchant_id: string
  merchant_name: string
  cnpj: string
  webhook_token: string
  pickup_rua: string
  pickup_numero: string
  pickup_complemento: string
  pickup_bairro: string
  pickup_cidade: string
  pickup_uf: string
  pickup_cep: string
  pickup_latitude: number | null
  pickup_longitude: number | null
  vehicle_type: string
  container: string
  container_size: string
  pickup_limit_min: number
  delivery_limit_min: number
  limit_times_as_datetime: boolean
  peso_padrao_g: number
}

const CONFIG_SELECT =
  'restaurante_id, ativo, base_url, client_id, client_secret, merchant_id, merchant_name, cnpj, webhook_token, ' +
  'pickup_rua, pickup_numero, pickup_complemento, pickup_bairro, pickup_cidade, pickup_uf, pickup_cep, pickup_latitude, pickup_longitude, ' +
  'vehicle_type, container, container_size, pickup_limit_min, delivery_limit_min, limit_times_as_datetime, peso_padrao_g'

function mapConfig(row: ConfigRow): NextaConfig {
  return {
    restauranteId: row.restaurante_id,
    ativo: row.ativo,
    baseUrl: row.base_url,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    cnpj: row.cnpj ?? '',
    webhookToken: row.webhook_token,
    pickup: {
      rua: row.pickup_rua ?? '',
      numero: row.pickup_numero ?? '',
      complemento: row.pickup_complemento ?? '',
      bairro: row.pickup_bairro ?? '',
      cidade: row.pickup_cidade ?? '',
      uf: row.pickup_uf ?? '',
      cep: row.pickup_cep ?? '',
      latitude: row.pickup_latitude ?? null,
      longitude: row.pickup_longitude ?? null,
    },
    vehicleType: row.vehicle_type,
    container: row.container,
    containerSize: row.container_size,
    pickupLimitMin: row.pickup_limit_min,
    deliveryLimitMin: row.delivery_limit_min,
    limitTimesAsDatetime: row.limit_times_as_datetime,
    pesoPadraoG: row.peso_padrao_g,
  }
}

/** Config completa (COM o segredo) — uso exclusivo de route handler com service_role. */
export async function buscarNextaConfig(admin: SupabaseClient, restauranteId: string): Promise<NextaConfig | null> {
  const { data, error } = await admin.from('nexta_config').select(CONFIG_SELECT).eq('restaurante_id', restauranteId).maybeSingle()
  if (error) throw error
  return data ? mapConfig(data as unknown as ConfigRow) : null
}

/** Localiza a loja pelo token da URL do webhook. */
export async function buscarNextaConfigPorWebhookToken(admin: SupabaseClient, token: string): Promise<NextaConfig | null> {
  const { data, error } = await admin.from('nexta_config').select(CONFIG_SELECT).eq('webhook_token', token).maybeSingle()
  if (error) throw error
  return data ? mapConfig(data as unknown as ConfigRow) : null
}

/** Config sem o segredo — é isto que trafega para o browser. */
export interface NextaConfigPublica {
  ativo: boolean
  baseUrl: string
  clientId: string
  /** O segredo nunca sai do servidor; o painel só sabe se já existe um salvo. */
  temSecret: boolean
  merchantId: string
  merchantName: string
  cnpj: string
  webhookToken: string
  pickup: NextaConfig['pickup']
  vehicleType: string
  container: string
  containerSize: string
  pickupLimitMin: number
  deliveryLimitMin: number
  limitTimesAsDatetime: boolean
  pesoPadraoG: number
}

export function paraConfigPublica(cfg: NextaConfig): NextaConfigPublica {
  return {
    ativo: cfg.ativo,
    baseUrl: cfg.baseUrl,
    clientId: cfg.clientId,
    temSecret: cfg.clientSecret !== '',
    merchantId: cfg.merchantId,
    merchantName: cfg.merchantName,
    cnpj: cfg.cnpj,
    webhookToken: cfg.webhookToken,
    pickup: cfg.pickup,
    vehicleType: cfg.vehicleType,
    container: cfg.container,
    containerSize: cfg.containerSize,
    pickupLimitMin: cfg.pickupLimitMin,
    deliveryLimitMin: cfg.deliveryLimitMin,
    limitTimesAsDatetime: cfg.limitTimesAsDatetime,
    pesoPadraoG: cfg.pesoPadraoG,
  }
}

export interface NextaConfigPatch {
  ativo?: boolean
  baseUrl?: string
  clientId?: string
  /** String vazia/ausente preserva o segredo atual — o form nunca recebe o valor salvo. */
  clientSecret?: string
  merchantId?: string
  merchantName?: string
  cnpj?: string
  pickup?: Partial<NextaConfig['pickup']>
  vehicleType?: string
  container?: string
  containerSize?: string
  pickupLimitMin?: number
  deliveryLimitMin?: number
  limitTimesAsDatetime?: boolean
  pesoPadraoG?: number
}

/**
 * Cria ou atualiza a config da loja. `webhook_token` nasce do default do banco.
 *
 * `merchant_id`: no padrão Open Delivery é um id que o RESTAURANTE escolhe. Na prática o
 * backend do Nexta resolve o estabelecimento por ele e só aceita o `client_id` que eles
 * emitiram — qualquer outro valor devolve `ERROR_FATAL "Unable to locate var:
 * integracaoEstabelecimento1.estabelecimento_id"` (verificado no sandbox em 2026-07-15).
 * Por isso o default é o client_id; o campo continua editável para o dia em que o Nexta
 * (ou outro operador) aceitar um id próprio.
 */
export async function salvarNextaConfig(admin: SupabaseClient, restauranteId: string, patch: NextaConfigPatch): Promise<NextaConfig> {
  const atual = await buscarNextaConfig(admin, restauranteId)

  const row: Record<string, unknown> = { restaurante_id: restauranteId }
  if (patch.ativo !== undefined) row.ativo = patch.ativo
  if (patch.baseUrl !== undefined) row.base_url = patch.baseUrl.trim()
  if (patch.clientId !== undefined) row.client_id = patch.clientId.trim()
  // Segredo só é gravado quando o lojista digita um novo; vazio = mantém o que está lá.
  if (patch.clientSecret) row.client_secret = patch.clientSecret.trim()
  if (patch.merchantId !== undefined) row.merchant_id = patch.merchantId.trim()
  if (patch.merchantName !== undefined) row.merchant_name = patch.merchantName.trim()
  if (patch.cnpj !== undefined) row.cnpj = patch.cnpj.replace(/\D/g, '')
  if (patch.vehicleType !== undefined) row.vehicle_type = patch.vehicleType
  if (patch.container !== undefined) row.container = patch.container
  if (patch.containerSize !== undefined) row.container_size = patch.containerSize
  if (patch.pickupLimitMin !== undefined) row.pickup_limit_min = patch.pickupLimitMin
  if (patch.deliveryLimitMin !== undefined) row.delivery_limit_min = patch.deliveryLimitMin
  if (patch.limitTimesAsDatetime !== undefined) row.limit_times_as_datetime = patch.limitTimesAsDatetime
  if (patch.pesoPadraoG !== undefined) row.peso_padrao_g = patch.pesoPadraoG

  if (patch.pickup) {
    const p = patch.pickup
    if (p.rua !== undefined) row.pickup_rua = p.rua.trim()
    if (p.numero !== undefined) row.pickup_numero = p.numero.trim()
    if (p.complemento !== undefined) row.pickup_complemento = p.complemento.trim()
    if (p.bairro !== undefined) row.pickup_bairro = p.bairro.trim()
    if (p.cidade !== undefined) row.pickup_cidade = p.cidade.trim()
    if (p.uf !== undefined) row.pickup_uf = p.uf.trim().toUpperCase().slice(0, 2)
    if (p.cep !== undefined) row.pickup_cep = p.cep.trim()
    if (p.latitude !== undefined) row.pickup_latitude = p.latitude
    if (p.longitude !== undefined) row.pickup_longitude = p.longitude
    // Endereço mexido invalida o geocode em cache — a próxima cotação recalcula.
    const mexeuNoEndereco = ['rua', 'numero', 'bairro', 'cidade', 'uf', 'cep'].some((k) => p[k as keyof typeof p] !== undefined)
    if (mexeuNoEndereco && p.latitude === undefined && p.longitude === undefined) {
      row.pickup_latitude = null
      row.pickup_longitude = null
    }
  }

  // Sem merchant_id explícito, espelha o client_id — é o único valor que o Nexta aceita.
  const merchantIdFinal = (row.merchant_id as string | undefined) ?? atual?.merchantId ?? ''
  if (!merchantIdFinal) {
    const clientId = (row.client_id as string | undefined) ?? atual?.clientId ?? ''
    if (clientId) row.merchant_id = clientId
  }

  const { data, error } = await admin.from('nexta_config').upsert(row, { onConflict: 'restaurante_id' }).select(CONFIG_SELECT).single()
  if (error) throw error
  return mapConfig(data as unknown as ConfigRow)
}

// ── Entregas ─────────────────────────────────────────────────────────────────

export interface NextaEntregaLinha {
  id: string
  restauranteId: string
  pedidoId: string
  deliveryId: string | null
  status: string
  preco: number | null
  etaColeta: string | null
  etaEntrega: string | null
  entregadorNome: string
  entregadorTelefone: string
  entregadorFotoUrl: string
  trackingUrl: string | null
  rejeicaoMotivo: string | null
  problema: unknown
  cancelAdditionalCharges: boolean | null
  criadoEm: string
  atualizadoEm: string
}

interface EntregaRow {
  id: string
  restaurante_id: string
  pedido_id: string
  delivery_id: string | null
  status: string
  preco: number | null
  eta_coleta: string | null
  eta_entrega: string | null
  entregador_nome: string | null
  entregador_telefone: string | null
  entregador_foto_url: string | null
  tracking_url: string | null
  rejeicao_motivo: string | null
  problema: unknown
  cancel_additional_charges: boolean | null
  criado_em: string
  atualizado_em: string
}

const ENTREGA_SELECT =
  'id, restaurante_id, pedido_id, delivery_id, status, preco, eta_coleta, eta_entrega, ' +
  'entregador_nome, entregador_telefone, entregador_foto_url, tracking_url, rejeicao_motivo, problema, ' +
  'cancel_additional_charges, criado_em, atualizado_em'

function mapEntrega(row: EntregaRow): NextaEntregaLinha {
  return {
    id: row.id,
    restauranteId: row.restaurante_id,
    pedidoId: row.pedido_id,
    deliveryId: row.delivery_id,
    status: row.status,
    preco: row.preco === null ? null : Number(row.preco),
    etaColeta: row.eta_coleta,
    etaEntrega: row.eta_entrega,
    entregadorNome: row.entregador_nome ?? '',
    entregadorTelefone: row.entregador_telefone ?? '',
    entregadorFotoUrl: row.entregador_foto_url ?? '',
    trackingUrl: row.tracking_url,
    rejeicaoMotivo: row.rejeicao_motivo,
    problema: row.problema ?? null,
    cancelAdditionalCharges: row.cancel_additional_charges,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  }
}

/** Entregas da loja desde uma data (default: todas). Usada pelo monitor e pelas métricas. */
export async function listarNextaEntregas(supabase: SupabaseClient, restauranteId: string, desdeISO?: string): Promise<NextaEntregaLinha[]> {
  let query = supabase.from('nexta_entregas').select(ENTREGA_SELECT).eq('restaurante_id', restauranteId)
  if (desdeISO) query = query.gte('criado_em', desdeISO)
  const { data, error } = await query.order('criado_em', { ascending: false }).limit(500)
  if (error) throw error
  return ((data ?? []) as unknown as EntregaRow[]).map(mapEntrega)
}

/** Entregas que ainda estão em andamento — o que o painel de despacho precisa desenhar. */
export async function listarNextaEntregasAtivas(supabase: SupabaseClient, restauranteId: string): Promise<NextaEntregaLinha[]> {
  const { data, error } = await supabase
    .from('nexta_entregas')
    .select(ENTREGA_SELECT)
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: false })
    .limit(200)
  if (error) throw error
  return ((data ?? []) as unknown as EntregaRow[]).map(mapEntrega).filter((e) => nextaEntregaAtiva(e.status))
}

/** A entrega ativa de um pedido, se houver. */
export async function buscarNextaEntregaAtivaDoPedido(supabase: SupabaseClient, pedidoId: string): Promise<NextaEntregaLinha | null> {
  const { data, error } = await supabase.from('nexta_entregas').select(ENTREGA_SELECT).eq('pedido_id', pedidoId).order('criado_em', { ascending: false })
  if (error) throw error
  const linhas = ((data ?? []) as unknown as EntregaRow[]).map(mapEntrega)
  return linhas.find((e) => nextaEntregaAtiva(e.status)) ?? null
}

/** Entrega + número do pedido e histórico de eventos — alimenta o monitor e as métricas. */
export interface NextaEntregaDetalhada extends NextaEntregaLinha {
  pedidoNumero: number | null
  /** Quanto o Nexta levou pra coletar, em minutos. Null enquanto não coletou. */
  minutosAteColeta: number | null
}

interface EventoRegistrado {
  recebidoEm?: string
  payload?: { event?: { type?: string } }
}

/**
 * Minutos entre a solicitação e a coleta, lidos do histórico de eventos.
 *
 * Não existe coluna `coletado_em`: o instante da coleta é derivado do primeiro
 * ORDER_PICKED recebido. "Primeiro" importa — o evento pode chegar repetido.
 */
function minutosAteColeta(criadoEm: string, eventos: unknown): number | null {
  if (!Array.isArray(eventos)) return null
  for (const e of eventos as EventoRegistrado[]) {
    if (e?.payload?.event?.type !== 'ORDER_PICKED' || !e.recebidoEm) continue
    const ms = new Date(e.recebidoEm).getTime() - new Date(criadoEm).getTime()
    return ms > 0 ? ms / 60_000 : null
  }
  return null
}

export async function listarNextaEntregasDetalhadas(
  supabase: SupabaseClient,
  restauranteId: string,
  desdeISO: string
): Promise<NextaEntregaDetalhada[]> {
  const { data, error } = await supabase
    .from('nexta_entregas')
    .select(`${ENTREGA_SELECT}, eventos, pedidos ( numero )`)
    .eq('restaurante_id', restauranteId)
    .gte('criado_em', desdeISO)
    .order('criado_em', { ascending: false })
    .limit(500)
  if (error) throw error

  return ((data ?? []) as unknown as (EntregaRow & { eventos: unknown; pedidos: { numero: number } | { numero: number }[] | null })[]).map((row) => {
    const pedido = Array.isArray(row.pedidos) ? row.pedidos[0] : row.pedidos
    return {
      ...mapEntrega(row),
      pedidoNumero: pedido?.numero ?? null,
      minutosAteColeta: minutosAteColeta(row.criado_em, row.eventos),
    }
  })
}

/** Localiza a entrega pelo orderId (= id da linha) — entrada do webhook. */
export async function buscarNextaEntrega(admin: SupabaseClient, orderId: string): Promise<NextaEntregaLinha | null> {
  const { data, error } = await admin.from('nexta_entregas').select(ENTREGA_SELECT).eq('id', orderId).maybeSingle()
  if (error) throw error
  return data ? mapEntrega(data as unknown as EntregaRow) : null
}

/**
 * Reserva a linha da entrega ANTES de chamar o Nexta: o índice parcial
 * `nexta_entregas_ativa_por_pedido` é quem garante que dois cliques simultâneos não
 * viram duas corridas. O id gerado aqui é o `orderId` enviado ao Nexta.
 */
export async function criarNextaEntrega(
  admin: SupabaseClient,
  restauranteId: string,
  pedidoId: string,
  cotacao: { preco: number; bruto: unknown; etaColetaEm: string | null; etaEntregaEm: string | null }
): Promise<NextaEntregaLinha> {
  const { data, error } = await admin
    .from('nexta_entregas')
    .insert({
      restaurante_id: restauranteId,
      pedido_id: pedidoId,
      status: 'PENDING',
      preco: cotacao.preco,
      cotacao: cotacao.bruto,
      eta_coleta: cotacao.etaColetaEm,
      eta_entrega: cotacao.etaEntregaEm,
    })
    .select(ENTREGA_SELECT)
    .single()
  if (error) throw error
  return mapEntrega(data as unknown as EntregaRow)
}

export interface NextaEntregaPatch {
  deliveryId?: string | null
  status?: string
  preco?: number | null
  etaColeta?: string | null
  etaEntrega?: string | null
  entregadorNome?: string
  entregadorTelefone?: string
  entregadorFotoUrl?: string
  trackingUrl?: string | null
  rejeicaoMotivo?: string | null
  problema?: unknown
  cancelAdditionalCharges?: boolean | null
}

export async function atualizarNextaEntrega(admin: SupabaseClient, id: string, patch: NextaEntregaPatch): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.deliveryId !== undefined) row.delivery_id = patch.deliveryId
  if (patch.status !== undefined) row.status = patch.status
  if (patch.preco !== undefined) row.preco = patch.preco
  if (patch.etaColeta !== undefined) row.eta_coleta = patch.etaColeta
  if (patch.etaEntrega !== undefined) row.eta_entrega = patch.etaEntrega
  if (patch.entregadorNome !== undefined) row.entregador_nome = patch.entregadorNome
  if (patch.entregadorTelefone !== undefined) row.entregador_telefone = patch.entregadorTelefone
  if (patch.entregadorFotoUrl !== undefined) row.entregador_foto_url = patch.entregadorFotoUrl
  if (patch.trackingUrl !== undefined) row.tracking_url = patch.trackingUrl
  if (patch.rejeicaoMotivo !== undefined) row.rejeicao_motivo = patch.rejeicaoMotivo
  if (patch.problema !== undefined) row.problema = patch.problema
  if (patch.cancelAdditionalCharges !== undefined) row.cancel_additional_charges = patch.cancelAdditionalCharges
  if (Object.keys(row).length === 0) return

  const { error } = await admin.from('nexta_entregas').update(row).eq('id', id)
  if (error) throw error
}

/** Acrescenta o webhook cru ao histórico append-only (auditoria e suporte). */
export async function registrarEventoNextaEntrega(admin: SupabaseClient, id: string, evento: unknown): Promise<void> {
  const { data, error } = await admin.from('nexta_entregas').select('eventos').eq('id', id).maybeSingle()
  if (error) throw error
  const eventos = Array.isArray(data?.eventos) ? (data.eventos as unknown[]) : []
  // Teto de segurança: eventos de movimento repetem a cada poucos segundos e um jsonb
  // sem limite viraria um problema de armazenamento na linha.
  const proximo = [...eventos, evento].slice(-200)
  const { error: updateError } = await admin.from('nexta_entregas').update({ eventos: proximo }).eq('id', id)
  if (updateError) throw updateError
}

/** Remove a linha reservada quando o Nexta recusa a criação (nunca chegou a existir lá). */
export async function apagarNextaEntrega(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from('nexta_entregas').delete().eq('id', id)
  if (error) throw error
}

// ── Vínculo com o pedido ─────────────────────────────────────────────────────

/** Aponta o pedido para a solicitação ativa (o painel usa isso pra saber que está "com o Nexta"). */
export async function vincularEntregaAoPedido(admin: SupabaseClient, pedidoId: string, entregaId: string | null): Promise<void> {
  const { error } = await admin.from('pedidos').update({ nexta_entrega_id: entregaId }).eq('id', pedidoId)
  if (error) throw error
}

/**
 * Solta o pedido do Nexta, mas só se ele ainda apontar para ESTA entrega — evita que o
 * webhook atrasado de uma corrida cancelada desvincule a retentativa que já começou.
 */
export async function desvincularEntregaDoPedido(admin: SupabaseClient, pedidoId: string, entregaId: string): Promise<void> {
  const { error } = await admin.from('pedidos').update({ nexta_entrega_id: null }).eq('id', pedidoId).eq('nexta_entrega_id', entregaId)
  if (error) throw error
}

/** Guarda o geocode do endereço de entrega no pedido (cache — evita repagar o Google). */
export async function salvarCoordenadasPedido(admin: SupabaseClient, pedidoId: string, lat: number, lng: number): Promise<void> {
  const { error } = await admin.from('pedidos').update({ entrega_latitude: lat, entrega_longitude: lng }).eq('id', pedidoId)
  if (error) throw error
}
