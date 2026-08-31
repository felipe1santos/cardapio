'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from '@supabase/supabase-js'

/**
 * Conciliação entre Realtime e polling nas telas operacionais.
 *
 * Antes, as telas de pedidos mantinham as duas coisas ligadas ao mesmo tempo: o
 * canal Realtime *e* um `setInterval` de 6–10 s. Com o canal saudável, o poll só
 * repetia o que o evento já tinha entregue — medido em ~30 KB por refetch do
 * Kanban num dia de pico, 7,5 vezes por minuto, por aba aberta.
 *
 * Aqui o polling passa a ser o que sempre deveria ter sido: uma rede de
 * segurança. Com o canal `SUBSCRIBED` ele cai para um heartbeat lento; se o
 * canal cair, volta ao ritmo agressivo. E toda vez que o canal (re)conecta, o
 * chamador recebe um aviso para sincronizar uma vez — assim nada que tenha
 * acontecido durante a queda se perde.
 */

/** Heartbeat com o canal saudável. Existe só para cobrir evento perdido em silêncio. */
export const INTERVALO_REALTIME_OK = 60_000
/** Ritmo de fallback quando o canal está caído — o mesmo de antes desta mudança. */
export const INTERVALO_FALLBACK = 8_000

export interface AssinaturaTabela {
  tabela: string
  /** Filtro no formato do Realtime, ex.: `restaurante_id=eq.<id>`. */
  filtro?: string
}

interface Opcoes {
  supabase: SupabaseClient
  /** Nome único do canal. `null` desliga a assinatura (ex.: id ainda não carregado). */
  canal: string | null
  tabelas: AssinaturaTabela[]
  /** Chamado a cada evento do Postgres. */
  aoEvento: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
  /** Chamado uma vez a cada (re)conexão, para sincronizar o que passou offline. */
  aoSincronizar: () => void
}

/**
 * Assina o canal e devolve o intervalo de polling adequado ao estado atual dele.
 * O chamador usa esse número no seu `setInterval`.
 */
export function useRealtimeComFallback({ supabase, canal, tabelas, aoEvento, aoSincronizar }: Opcoes): {
  saudavel: boolean
  intervaloMs: number
} {
  const [saudavel, setSaudavel] = useState(false)

  // Guardados em ref para que trocar de callback não derrube e recrie o canal.
  const aoEventoRef = useRef(aoEvento)
  const aoSincronizarRef = useRef(aoSincronizar)
  aoEventoRef.current = aoEvento
  aoSincronizarRef.current = aoSincronizar

  const chaveTabelas = JSON.stringify(tabelas)

  useEffect(() => {
    if (!canal) return
    const lista: AssinaturaTabela[] = JSON.parse(chaveTabelas)

    let ch: RealtimeChannel = supabase.channel(canal)
    for (const { tabela, filtro } of lista) {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabela, ...(filtro ? { filter: filtro } : {}) },
        (payload) => aoEventoRef.current(payload)
      )
    }

    ch.subscribe((status) => {
      const ok = status === 'SUBSCRIBED'
      setSaudavel(ok)
      // Reconectou: pode ter havido mudança enquanto o canal estava fora.
      if (ok) aoSincronizarRef.current()
    })

    return () => {
      setSaudavel(false)
      void supabase.removeChannel(ch)
    }
  }, [supabase, canal, chaveTabelas])

  return { saudavel, intervaloMs: saudavel ? INTERVALO_REALTIME_OK : INTERVALO_FALLBACK }
}
