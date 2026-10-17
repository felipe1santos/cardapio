'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { _zerarCacheRestauranteId } from '@/lib/queries/cardapio'

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
  /** Módulos pagos liberados na loja (0176). */
  modulos?: import('@/lib/modulos').ModulosDaLoja
  lojaNome?: string
  whatsappComercial?: string
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
  // Outra conta pode entrar em seguida neste navegador: nada da sessão anterior fica guardado.
  _zerarCacheRestauranteId()
  emVoo = null
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

// Menu, conta e trava pedem juntos na montagem: uma ida ao servidor serve aos três. Desempenho (10/10): a janela
// passou de 2 s para 15 s — partes que montam depois (topo, faixa, PDV) pegavam a 2ª e a 3ª ida. Mudança de verdade
// (PIN, trava, módulo, controle de caixa) chama estadoMudou(), que zera na hora.
const ESTADO_JANELA_MS = 15_000
let emVoo: { em: number; p: Promise<EstadoSessao | null> } | null = null

export function buscarEstadoSessao(): Promise<EstadoSessao | null> {
  if (emVoo && Date.now() - emVoo.em < ESTADO_JANELA_MS) return emVoo.p
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
    // Voltou para a aba: relê (módulo liberado no Super Admin aparece sem novo login, 0176).
    // Várias instâncias do hook ouvem o mesmo evento: só a primeira relê, as outras pegam a mesma resposta.
    const aoFocar = () => { if (document.visibilityState === 'visible') { if (!emVoo || Date.now() - emVoo.em > 2000) emVoo = null; carregar() } }
    document.addEventListener('visibilitychange', aoFocar)
    // Módulo ligado/desligado no Super Admin com o painel aberto e sem trocar de aba: relê a cada 1 min (16/10). As rotas e
    // APIs já bloqueiam na hora pelo servidor; isto só atualiza o menu (cadeado). Leitura do banco, sem custo de API.
    const relogio = setInterval(() => { if (document.visibilityState === 'visible') aoFocar() }, 60_000)
    return () => { vivo = false; clearInterval(relogio); window.removeEventListener(EVENTO_ESTADO, carregar); document.removeEventListener('visibilitychange', aoFocar) }
  }, [])
  return estado
}
