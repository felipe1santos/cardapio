/**
 * Cola entre o Menuzia e `lib/nexta.ts`: resolve a config da loja, transforma um
 * `Pedido` no formato que o Open Delivery espera e cuida do geocode dos dois endereços.
 *
 * SERVER-ONLY — importa `lib/nexta.ts` (node:crypto) e usa o client service_role.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeEndereco } from '@/lib/frete'
import { NextaError, type NextaConfig, type NextaEntrega, type NextaPedido } from '@/lib/nexta'
import { buscarNextaConfig, salvarCoordenadasPedido } from '@/lib/queries/nexta'
import { PEDIDO_SELECT, mapPedido, type Pedido } from '@/lib/queries/pedidos'

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Config da loja pronta para uso, ou erro legível. `exigirAtivo: false` serve ao botão
 * "Testar conexão", que precisa funcionar antes de a integração ser ligada.
 */
export async function carregarConfigNexta(
  admin: SupabaseClient,
  restauranteId: string,
  { exigirAtivo = true }: { exigirAtivo?: boolean } = {}
): Promise<NextaConfig> {
  const cfg = await buscarNextaConfig(admin, restauranteId)
  if (!cfg) throw new NextaError('Integração Nexta ainda não configurada nesta loja.', 0, null)
  if (exigirAtivo && !cfg.ativo) throw new NextaError('Integração Nexta está desativada.', 0, null)
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new NextaError('Integração Nexta sem credenciais. Configure em Integrações › Nexta.', 0, null)
  }
  if (!cfg.pickup.rua || !cfg.pickup.cidade || !cfg.pickup.uf) {
    throw new NextaError('Endereço de coleta da loja incompleto. Preencha em Integrações › Nexta.', 0, null)
  }
  return cfg
}

/** Pedido do banco (com dados de entrega) — erro se não for do tenant. */
export async function carregarPedidoNexta(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<Pedido> {
  const { data, error } = await admin
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('id', pedidoId)
    .eq('restaurante_id', restauranteId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new NextaError('Pedido não encontrado nesta loja.', 404, null)

  const pedido = mapPedido(data as unknown as Parameters<typeof mapPedido>[0])
  if (pedido.tipo !== 'entrega') throw new NextaError('Só pedidos de entrega podem ir para o Nexta.', 400, null)
  return pedido
}

/** `Pedido` → o subconjunto que o payload do Open Delivery usa. */
export function pedidoParaNexta(pedido: Pedido): NextaPedido {
  return {
    id: pedido.id,
    numero: pedido.numero,
    clienteNome: pedido.clienteNome,
    clienteTelefone: pedido.clienteTelefone,
    formaPagamento: pedido.formaPagamento,
    trocoPara: pedido.trocoPara,
    pago: pedido.pago,
    total: pedido.total,
    taxaEntrega: pedido.taxaEntrega,
    criadoEm: pedido.criadoEm,
    itens: pedido.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade })),
  }
}

/**
 * Endereço de entrega do pedido no formato do Nexta, com lat/lng resolvidas.
 *
 * O checkout nunca guardou o geocode do cliente, então a primeira cotação de cada pedido
 * paga um geocode e grava o resultado em `pedidos.entrega_latitude/longitude` — as
 * recotações seguintes saem de graça. Geocode que falha não bloqueia: a spec aceita
 * endereço sem coordenadas, e o Nexta resolve pelo texto.
 */
export async function montarEntregaDoPedido(admin: SupabaseClient, cfg: NextaConfig, pedido: Pedido, coordCache: { lat: number | null; lng: number | null }): Promise<NextaEntrega> {
  let lat = coordCache.lat
  let lng = coordCache.lng

  if (lat === null || lng === null) {
    const texto = [pedido.enderecoRua, pedido.enderecoNumero, pedido.enderecoBairro, cfg.pickup.cidade]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(', ')
    const coord = await geocodeEndereco({ cep: pedido.enderecoCep || undefined, endereco: texto || undefined }, MAPS_KEY)
    if (coord) {
      lat = coord.lat
      lng = coord.lng
      // Cache de melhor esforço: falhar aqui não pode derrubar a cotação do lojista.
      try {
        await salvarCoordenadasPedido(admin, pedido.id, coord.lat, coord.lng)
      } catch (err) {
        console.error(`[nexta] falha ao cachear geocode do pedido ${pedido.id}:`, err)
      }
    } else {
      console.warn(`[nexta] sem coordenadas para o pedido ${pedido.id} — cotando pelo endereço completo.`)
    }
  }

  return {
    rua: pedido.enderecoRua,
    numero: pedido.enderecoNumero,
    complemento: pedido.enderecoComplemento ?? '',
    bairro: pedido.enderecoBairro,
    // O pedido não guarda cidade/UF: a entrega é sempre na área da loja, então herdamos dela.
    cidade: cfg.pickup.cidade,
    uf: cfg.pickup.uf,
    cep: pedido.enderecoCep,
    latitude: lat,
    longitude: lng,
    instrucoes: pedido.observacao ?? '',
  }
}

/**
 * Garante lat/lng do endereço de coleta, geocodificando e persistindo na 1ª vez.
 * Devolve a config já com as coordenadas resolvidas.
 */
export async function resolverCoordenadasColeta(admin: SupabaseClient, cfg: NextaConfig): Promise<NextaConfig> {
  if (cfg.pickup.latitude !== null && cfg.pickup.longitude !== null) return cfg

  const texto = [cfg.pickup.rua, cfg.pickup.numero, cfg.pickup.bairro, cfg.pickup.cidade, cfg.pickup.uf]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(', ')
  const coord = await geocodeEndereco({ cep: cfg.pickup.cep || undefined, endereco: texto || undefined }, MAPS_KEY)
  if (!coord) {
    console.warn(`[nexta] sem coordenadas para o endereço de coleta da loja ${cfg.restauranteId}.`)
    return cfg
  }

  try {
    await admin.from('nexta_config').update({ pickup_latitude: coord.lat, pickup_longitude: coord.lng }).eq('restaurante_id', cfg.restauranteId)
  } catch (err) {
    console.error(`[nexta] falha ao cachear geocode da coleta da loja ${cfg.restauranteId}:`, err)
  }
  return { ...cfg, pickup: { ...cfg.pickup, latitude: coord.lat, longitude: coord.lng } }
}

/** Erro de rota padronizado: mensagem amigável do NextaError, genérica para o resto. */
export function erroNexta(err: unknown): { mensagem: string; status: number } {
  if (err instanceof NextaError) {
    // 0 = falha nossa de configuração/rede: 400 comunica melhor que 500 pro painel.
    return { mensagem: err.message, status: err.status >= 400 && err.status < 600 ? err.status : 400 }
  }
  console.error('[nexta] erro inesperado:', err)
  // Painel admin: expõe a mensagem crua do erro pra dar pé no diagnóstico da integração.
  // NextaError (que carrega corpo do Nexta) é tratado acima; aqui só cai exceção nossa.
  const detalhe = err instanceof Error && err.message ? `: ${err.message}` : ''
  return { mensagem: `Erro inesperado ao falar com o Nexta${detalhe}`, status: 500 }
}
