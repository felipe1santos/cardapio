'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'

/**
 * Um canal de `pedidos` por aba (achado #6 da auditoria, 25/10). Antes, contadores do menu, alarme e a tela aberta
 * (Kanban, Logística, KDS, PDV…) assinavam cada um a mesma tabela: cada mudança num pedido chegava 3–4 vezes e cada cópia
 * disparava sua própria recarga (~11 requisições por evento no Kanban). O layout abre este canal uma vez e o repassa por
 * contexto; quem precisa de evento de pedido se pendura nele.
 */

export type EventoPedido = RealtimePostgresChangesPayload<Record<string, unknown>>
type AoEvento = (payload: EventoPedido) => void

export interface CanalPedidos {
  restauranteId: string
  /** Pendura um ouvinte; devolve a função que tira. `aoSincronizar` roda a cada (re)conexão do canal. */
  ouvir: (aoEvento: AoEvento, aoSincronizar?: () => void) => () => void
  /** Avisado a cada mudança de saúde do canal. */
  ouvirSaude: (fn: (ok: boolean) => void) => () => void
  saudavel: () => boolean
  fechar: () => void
}

export function abrirCanalPedidos(supabase: SupabaseClient, restauranteId: string): CanalPedidos {
  const ouvintes = new Set<{ aoEvento: AoEvento; aoSincronizar?: () => void }>()
  const saude = new Set<(ok: boolean) => void>()
  let ok = false
  const canal = supabase
    .channel(`pedidos-${restauranteId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` }, (payload) => {
      for (const o of [...ouvintes]) o.aoEvento(payload as EventoPedido)
    })
    .subscribe((status) => {
      ok = status === 'SUBSCRIBED'
      for (const fn of [...saude]) fn(ok)
      // Reconectou: pode ter havido mudança enquanto o canal estava fora.
      if (ok) for (const o of [...ouvintes]) o.aoSincronizar?.()
    })
  return {
    restauranteId,
    ouvir(aoEvento, aoSincronizar) {
      const o = { aoEvento, aoSincronizar }
      ouvintes.add(o)
      return () => { ouvintes.delete(o) }
    },
    ouvirSaude(fn) {
      saude.add(fn)
      return () => { saude.delete(fn) }
    },
    saudavel: () => ok,
    fechar: () => { void supabase.removeChannel(canal) },
  }
}

/**
 * `undefined` = fora do layout do painel (abre canal próprio); `null` = dentro do layout, que ainda está abrindo o canal
 * (espera: os efeitos dos filhos rodam antes do efeito do layout, e sem isso cada tela abriria um canal por um instante).
 */
export const CanalPedidosContexto = createContext<CanalPedidos | null | undefined>(undefined)

export function useCanalPedidos(): CanalPedidos | null | undefined {
  return useContext(CanalPedidosContexto)
}

const ehPedidosDaLoja = (tabela: string, filtro?: string) => tabela === 'pedidos' && !!filtro?.startsWith('restaurante_id=eq.')

/** O filtro `restaurante_id=eq.<id>` da tabela `pedidos` é exatamente o do canal compartilhado? */
export function usaCanalCompartilhado(canal: CanalPedidos | null | undefined, tabela: string, filtro?: string): boolean {
  return !!canal && tabela === 'pedidos' && filtro === `restaurante_id=eq.${canal.restauranteId}`
}

/** Dentro do layout com o canal ainda abrindo: a tabela `pedidos` da loja espera por ele em vez de abrir outro. */
export function aguardaCanalCompartilhado(canal: CanalPedidos | null | undefined, tabela: string, filtro?: string): boolean {
  return canal === null && ehPedidosDaLoja(tabela, filtro)
}

/**
 * Eventos de `pedidos` da loja. Dentro do painel usa o canal do layout; fora dele (teste, tela avulsa) abre o próprio.
 * Os callbacks ficam em ref: trocar de função não derruba o canal.
 */
export function useEventosPedidos({ supabase, restauranteId, aoEvento, aoSincronizar }: {
  supabase: SupabaseClient
  restauranteId: string | null
  aoEvento: AoEvento
  aoSincronizar?: () => void
}): { saudavel: boolean } {
  const compartilhado = useCanalPedidos()
  const [saudavel, setSaudavel] = useState(false)
  const aoEventoRef = useRef(aoEvento)
  const aoSincronizarRef = useRef(aoSincronizar)
  aoEventoRef.current = aoEvento
  aoSincronizarRef.current = aoSincronizar

  useEffect(() => {
    if (!restauranteId || compartilhado === null) return
    const proprio = compartilhado && compartilhado.restauranteId === restauranteId ? null : abrirCanalPedidos(supabase, restauranteId)
    const canal = (proprio ?? compartilhado) as CanalPedidos
    setSaudavel(canal.saudavel())
    const sairSaude = canal.ouvirSaude(setSaudavel)
    const sair = canal.ouvir((p) => aoEventoRef.current(p), () => aoSincronizarRef.current?.())
    return () => {
      sair()
      sairSaude()
      setSaudavel(false)
      proprio?.fechar()
    }
  }, [supabase, restauranteId, compartilhado])

  return { saudavel }
}
