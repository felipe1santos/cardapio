'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Mapas no NAVEGADOR sem chamada paga (incidente de 09/10, docs/REGRAS-DE-CUSTO.md): o navegador nunca chama
 * Geocoder nem DirectionsService. Coordenadas e rota vêm do servidor (/api/mapa/*), que passa pela guarda de
 * custo, usa o cache e grava as coordenadas no pedido. Aqui ficam as regras puras (testadas) e um hook que só
 * pede ao servidor quando o CONJUNTO de pedidos muda — e só os que ainda não têm resposta nesta sessão.
 */

export interface Coord { lat: number; lng: number }
export type CoordOuNada = Coord | null

/** Chave estável de um conjunto de ids (a ordem não importa). */
export function chaveConjunto(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join(',')
}

/** Teto de pedidos com coordenada por tela (o Dashboard leva os endereços que mais pedem). */
export const LIMITE_TOTAL = 300

/** Divide em lotes de `n`. */
export function emLotes<T>(lista: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n))
  return out
}

/** Ids que ainda não têm resposta (null também é resposta: não pede de novo). Máx. `limite` de uma vez. */
export function idsAPedir(ids: readonly string[], conhecidos: ReadonlyMap<string, CoordOuNada>, limite = 100): string[] {
  return [...new Set(ids)].filter((id) => !conhecidos.has(id)).slice(0, limite)
}

const ehCoord = (v: unknown): v is Coord =>
  !!v && typeof v === 'object' && Number.isFinite((v as Coord).lat) && Number.isFinite((v as Coord).lng)

/** POST /api/mapa/coordenadas — { coords: { id: {lat,lng} | null } }. Erro de rede/servidor: null para todos. */
export async function buscarCoordenadas(ids: string[], token?: string | null): Promise<Record<string, CoordOuNada>> {
  const vazio = Object.fromEntries(ids.map((id) => [id, null])) as Record<string, CoordOuNada>
  if (ids.length === 0) return {}
  try {
    const r = await fetch('/api/mapa/coordenadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoIds: ids, ...(token ? { token } : {}) }),
    })
    if (!r.ok) return vazio
    const j = (await r.json().catch(() => null)) as { coords?: Record<string, unknown> } | null
    const out: Record<string, CoordOuNada> = {}
    for (const id of ids) {
      const c = j?.coords?.[id]
      out[id] = ehCoord(c) ? { lat: c.lat, lng: c.lng } : null
    }
    return out
  } catch {
    return vazio
  }
}

/** POST /api/mapa/rota — polyline codificada ou null ("Rota indisponível no momento"). */
export async function buscarRota(origem: Coord, paradas: Coord[], token?: string | null): Promise<{ polyline: string | null; motivo?: string }> {
  if (paradas.length === 0) return { polyline: null }
  try {
    const r = await fetch('/api/mapa/rota', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origem, paradas: paradas.slice(0, 23), ...(token ? { token } : {}) }),
    })
    if (!r.ok) return { polyline: null }
    const j = (await r.json().catch(() => null)) as { polyline?: unknown; motivo?: unknown } | null
    return { polyline: typeof j?.polyline === 'string' && j.polyline ? j.polyline : null, motivo: typeof j?.motivo === 'string' ? j.motivo : undefined }
  } catch {
    return { polyline: null }
  }
}

/** POST /api/mapa/geocodificar (só painel) — pin da loja em Ajustes. */
export async function geocodificarEndereco(endereco: string): Promise<CoordOuNada> {
  if (!endereco.trim()) return null
  try {
    const r = await fetch('/api/mapa/geocodificar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endereco }),
    })
    if (!r.ok) return null
    const j = (await r.json().catch(() => null)) as unknown
    return ehCoord(j) ? { lat: (j as Coord).lat, lng: (j as Coord).lng } : null
  } catch {
    return null
  }
}

/** Chave de uma rota (origem + paradas arredondadas a ~10 m): a mesma rota não é pedida duas vezes. */
export function chaveRotaPedido(origem: Coord, paradas: Coord[]): string {
  const f = (c: Coord) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
  return [f(origem), ...paradas.map(f)].join('|')
}

/** Intervalo mínimo entre pedidos de rota para o MESMO conjunto de paradas (o GPS do motoboy muda a origem). */
export const ROTA_INTERVALO_MS = 60_000

/** Pode pedir a rota agora? Conjunto de paradas novo: sim; o mesmo: só depois de ROTA_INTERVALO_MS. */
export function podePedirRota(ultima: { paradas: string; em: number } | null, paradas: string, agora: number): boolean {
  return !ultima || ultima.paradas !== paradas || agora - ultima.em >= ROTA_INTERVALO_MS
}

/**
 * Coordenadas dos pedidos `ids`: pede ao servidor só quando o conjunto muda e só os que faltam; a resposta
 * (inclusive null) fica guardada ANTES de olhar se o efeito foi cancelado — nunca pede o mesmo id duas vezes.
 * Devolve um Map (id → coord | null) que muda de identidade só quando chega resposta nova.
 */
export function useCoordenadasPedidos(ids: readonly string[], token?: string | null): ReadonlyMap<string, CoordOuNada> {
  const conhecidos = useRef<Map<string, CoordOuNada>>(new Map())
  const emVoo = useRef<Set<string>>(new Set())
  const montado = useRef(true)
  const [mapa, setMapa] = useState<ReadonlyMap<string, CoordOuNada>>(() => new Map())
  const chave = chaveConjunto(ids)

  useEffect(() => {
    montado.current = true
    return () => { montado.current = false }
  }, [])

  useEffect(() => {
    const lista = chave ? chave.split(',') : []
    const faltam = idsAPedir(lista, conhecidos.current, LIMITE_TOTAL).filter((id) => !emVoo.current.has(id))
    if (faltam.length === 0) return
    faltam.forEach((id) => emVoo.current.add(id))
    // Lotes de 100 (limite da rota), um depois do outro.
    void (async () => {
      for (const lote of emLotes(faltam, 100)) {
        const r = await buscarCoordenadas(lote, token)
        // Guarda primeiro, sem olhar se o conjunto já mudou: a resposta nunca se perde nem se repete.
        for (const id of lote) { conhecidos.current.set(id, r[id] ?? null); emVoo.current.delete(id) }
        if (montado.current) setMapa(new Map(conhecidos.current))
      }
    })()
  }, [chave, token])

  return mapa
}
