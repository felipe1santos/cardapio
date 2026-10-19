'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarStatusELoja } from '@/lib/queries/ajustes'
import { lojaEstaAberta, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'

/**
 * Aberta/fechada da loja para a tag do menu (redesign 18/10): lê a mesma regra do Kanban (status manual ou grade de
 * horário), recalcula a cada minuto (a grade vira sozinha) e ouve o evento que o Kanban dispara ao mudar o status —
 * assim a tag acompanha "Recebendo pedidos" na hora, sem recarregar. Leitura do banco, sem custo de API.
 */
export const EVENTO_STATUS_LOJA = 'menuzia:status-loja'

export interface EstadoLoja { aberta: boolean; modo: 'manual' | 'automatico' }

export function avisarStatusLoja(status: StatusLoja) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENTO_STATUS_LOJA, { detail: status }))
}

export function useStatusLoja(supabase: SupabaseClient, restauranteId: string | null): EstadoLoja | null {
  const [base, setBase] = useState<{ statusLoja: StatusLoja; horarioFuncionamento: HorarioFuncionamento | null } | null>(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!restauranteId) return
    let vivo = true
    const ler = () => buscarStatusELoja(supabase, restauranteId).then((s) => { if (vivo && s) setBase(s) }).catch(() => {})
    void ler()
    const aoMudar = (e: Event) => { const d = (e as CustomEvent<StatusLoja>).detail; if (d) setBase((b) => (b ? { ...b, statusLoja: d } : b)); void ler() }
    window.addEventListener(EVENTO_STATUS_LOJA, aoMudar)
    // A grade de horário abre/fecha sozinha: reavalia a cada minuto (puro, sem rede).
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    const aoVoltar = () => { if (document.visibilityState === 'visible') void ler() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { vivo = false; window.removeEventListener(EVENTO_STATUS_LOJA, aoMudar); clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [supabase, restauranteId])
  if (!base) return null
  return { aberta: lojaEstaAberta(base), modo: base.statusLoja === 'automatico' ? 'automatico' : 'manual' }
}
