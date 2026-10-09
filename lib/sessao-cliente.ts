'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Lado do navegador da sessão do painel (0132): sair registrado, estado (financeiro ligado,
 * PIN, trava) e o pedido de "travar a tela" / "trocar operador" que o menu de conta dispara
 * e a TravaSessao (no layout) atende.
 */
export interface EstadoSessao {
  financeiroAtivo: boolean
  /** Nível 2 (0167): caixa à mão, trava de tela, troca de operador, aviso de caixa. */
  controleCaixa: boolean
  temPin: boolean
  inatividadeMin: number
  travada: boolean
  nome: string
}

export const EVENTO_TRAVAR = 'menuzia:travar-tela'
export const EVENTO_ESTADO = 'menuzia:estado-sessao'
export const EVENTO_SAIR_CAIXA = 'menuzia:sair-caixa-aberto'

/**
 * Sair do painel: registra no servidor (auditoria + sessão encerrada) e faz o signOut. Devolve
 * false quando o servidor pede justificativa (quem abriu o caixa saindo com ele aberto): aí a
 * janela de justificativa (layout) assume e chama de novo com o texto.
 */
export async function sairDoPainel(supabase: SupabaseClient, justificativa?: string): Promise<boolean> {
  try {
    const r = await fetch('/api/sessao/sair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(justificativa ? { justificativa } : {}), keepalive: true })
    if (r.status === 409) {
      window.dispatchEvent(new Event(EVENTO_SAIR_CAIXA))
      return false
    }
  } catch {
    /* sem rede: sai do mesmo jeito; a sessão expira pela janela de inatividade */
  }
  await supabase.auth.signOut()
  return true
}

export function pedirTrava(modo: 'travar' | 'trocar') {
  window.dispatchEvent(new CustomEvent(EVENTO_TRAVAR, { detail: modo }))
}

/** Avisa quem mostra o estado (menu de conta, trava) que ele mudou — ex.: acabou de criar o PIN. */
export function estadoMudou() {
  emVoo = null
  window.dispatchEvent(new Event(EVENTO_ESTADO))
}

// Menu, conta e trava pedem juntos na montagem: uma ida ao servidor serve aos três.
let emVoo: { em: number; p: Promise<EstadoSessao | null> } | null = null

export function buscarEstadoSessao(): Promise<EstadoSessao | null> {
  if (emVoo && Date.now() - emVoo.em < 2000) return emVoo.p
  emVoo = { em: Date.now(), p: buscar() }
  return emVoo.p
}

async function buscar(): Promise<EstadoSessao | null> {
  try {
    const r = await fetch('/api/sessao/estado', { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as EstadoSessao
  } catch {
    return null
  }
}

export function useEstadoSessao(): EstadoSessao | null {
  const [estado, setEstado] = useState<EstadoSessao | null>(null)
  useEffect(() => {
    let vivo = true
    const carregar = () => void buscarEstadoSessao().then((e) => { if (vivo && e) setEstado(e) })
    carregar()
    window.addEventListener(EVENTO_ESTADO, carregar)
    return () => { vivo = false; window.removeEventListener(EVENTO_ESTADO, carregar) }
  }, [])
  return estado
}
