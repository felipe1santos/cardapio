import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeEndereco, type Coord } from '@/lib/frete'

/**
 * Coordenadas dos pedidos (10/10): a gravada no pedido (entrega_latitude/longitude) ou, sem ela, UMA geocodificação
 * no servidor (cache + guarda de custo) gravada no pedido — o mapa, a rota e o QR nunca geocodificam de novo.
 * Por chamada geocodifica no máximo MAX_NOVAS endereços (o resto vem na próxima).
 */
export const MAX_NOVAS = 10

type LinhaEndereco = { endereco_rua?: string | null; endereco_numero?: string | null; endereco_bairro?: string | null; endereco_cidade?: string | null }

/** Texto do endereço do pedido para o geocode (sem vazios). Pura. */
export function enderecoDoPedido(p: LinhaEndereco): string {
  return [p.endereco_rua, p.endereco_numero, p.endereco_bairro, p.endereco_cidade].map((s) => (s ?? '').trim()).filter(Boolean).join(', ')
}

export async function coordenadasDosPedidos(admin: SupabaseClient, loja: string, ids: string[]): Promise<Record<string, Coord | null>> {
  const out: Record<string, Coord | null> = {}
  if (!ids.length) return out
  const { data } = await admin.from('pedidos')
    .select('id, tipo, entrega_latitude, entrega_longitude, endereco_rua, endereco_numero, endereco_bairro, endereco_cidade, endereco_cep')
    .eq('restaurante_id', loja).in('id', ids)
  let novas = 0
  for (const p of (data ?? []) as (LinhaEndereco & { id: string; tipo: string; entrega_latitude: number | null; entrega_longitude: number | null; endereco_cep: string | null })[]) {
    if (p.entrega_latitude !== null && p.entrega_longitude !== null) { out[p.id] = { lat: Number(p.entrega_latitude), lng: Number(p.entrega_longitude) }; continue }
    if (p.tipo !== 'entrega' || novas >= MAX_NOVAS) { out[p.id] = null; continue }
    novas++
    const texto = enderecoDoPedido(p)
    const { coord } = await geocodeEndereco(admin, { cep: p.endereco_cep || undefined, endereco: texto || undefined }, loja)
    out[p.id] = coord
    if (coord) await admin.from('pedidos').update({ entrega_latitude: coord.lat, entrega_longitude: coord.lng }).eq('id', p.id).eq('restaurante_id', loja).then(() => {}, () => {})
  }
  return out
}

/** Geocodifica o pedido recém-criado UMA vez e grava (sem segurar o checkout/PDV). */
export async function gravarCoordenadasDoPedido(admin: SupabaseClient, loja: string, pedidoId: string): Promise<void> {
  try { await coordenadasDosPedidos(admin, loja, [pedidoId]) } catch (e) { console.error('[mapa] coordenadas do pedido', pedidoId, (e as Error).message) }
}
