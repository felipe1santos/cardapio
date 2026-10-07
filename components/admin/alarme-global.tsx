'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { listarRecebidosParaAlarme } from '@/lib/queries/pedidos'
import { useAlarmePedidos } from '@/components/pedidos/use-alarme'
import { textoDoTituloPiscando } from '@/lib/alarme-pedidos'

/**
 * Alarme de pedido novo em QUALQUER tela do painel (2026-10-04). Antes ele só existia no Painel de
 * Pedidos: quem estava no Cardápio, no Financeiro ou no PDV não ouvia nada.
 *
 * - O provider vive no layout do painel e tem a própria fonte dos pedidos "recebido" (tempo real +
 *   leitura a cada 20 s + ao voltar para a aba). O Painel de Pedidos só usa os controles (ligar,
 *   silenciar, repetição, testar) — não alimenta mais o alarme, para não haver duas fontes.
 * - Som bloqueado pelo navegador (ninguém tocou na página desde que ela abriu): aviso grande no topo
 *   de toda tela, "Toque aqui para ativar o som de novos pedidos". Some no primeiro toque/clique.
 * - Enquanto o som estiver bloqueado (ou a aba escondida) e houver pedido esperando: o título da aba
 *   pisca com o número do pedido e o aviso volta a pulsar.
 * - Só para quem tem acesso ao Painel de Pedidos (`ativo`).
 */
type ValorAlarme = ReturnType<typeof useAlarmePedidos> & { pendentes: { id: string; numero: number }[]; ativo: boolean }
const AlarmeContexto = createContext<ValorAlarme | null>(null)

/** Controles do alarme (Painel de Pedidos). Fora do provider (não deveria acontecer): null. */
export function useAlarme(): ValorAlarme | null {
  return useContext(AlarmeContexto)
}

const LEITURA_MS = 20_000

export function AlarmeProvider({ restauranteId, ativo, children }: { restauranteId: string | null; ativo: boolean; children: ReactNode }) {
  const alarme = useAlarmePedidos({ ativo })
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [pendentes, setPendentes] = useState<{ id: string; numero: number }[]>([])
  const aoAtualizar = useRef(alarme.aoAtualizarPedidos)
  aoAtualizar.current = alarme.aoAtualizarPedidos

  useEffect(() => {
    if (!restauranteId || !ativo) return
    let vivo = true
    let lendo = false
    let deNovo = false
    const ler = async () => {
      if (lendo) { deNovo = true; return }
      lendo = true
      try {
        const lista = await listarRecebidosParaAlarme(supabase, restauranteId)
        if (!vivo) return
        setPendentes(lista)
        aoAtualizar.current(lista)
      } catch {
        /* rede caiu: a próxima leitura (tempo real, relógio ou volta à aba) tenta de novo */
      } finally {
        lendo = false
        if (deNovo && vivo) { deNovo = false; void ler() }
      }
    }
    void ler()
    const canal = supabase
      .channel(`alarme-${restauranteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` }, () => void ler())
      .subscribe((status) => { if (status === 'SUBSCRIBED') void ler() })
    const relogio = setInterval(() => void ler(), LEITURA_MS)
    const aoVoltar = () => { if (document.visibilityState === 'visible') void ler() }
    document.addEventListener('visibilitychange', aoVoltar)
    window.addEventListener('online', aoVoltar)
    return () => {
      vivo = false
      clearInterval(relogio)
      document.removeEventListener('visibilitychange', aoVoltar)
      window.removeEventListener('online', aoVoltar)
      void supabase.removeChannel(canal)
    }
  }, [supabase, restauranteId, ativo])

  useTituloPiscando(ativo && alarme.somAtivo ? pendentes : [], alarme.bloqueado)

  const valor = useMemo(() => ({ ...alarme, pendentes, ativo }), [alarme, pendentes, ativo])
  return <AlarmeContexto.Provider value={valor}>{children}</AlarmeContexto.Provider>
}

/** Título da aba piscando com o pedido que espera, quando o som não chega (bloqueado ou aba escondida). */
function useTituloPiscando(pendentes: { numero: number }[], bloqueado: boolean) {
  const [escondida, setEscondida] = useState(false)
  useEffect(() => {
    const ver = () => setEscondida(document.visibilityState !== 'visible')
    ver()
    document.addEventListener('visibilitychange', ver)
    return () => document.removeEventListener('visibilitychange', ver)
  }, [])
  const piscar = pendentes.length > 0 && (bloqueado || escondida)
  const numeros = pendentes.map((p) => p.numero).join(',')
  useEffect(() => {
    if (!piscar) return
    const original = document.title
    let ligado = false
    const nums = numeros.split(',').map(Number)
    const t = setInterval(() => {
      ligado = !ligado
      document.title = ligado ? textoDoTituloPiscando(nums) : original
    }, 1000)
    return () => { clearInterval(t); document.title = original }
  }, [piscar, numeros])
}

/**
 * Aviso grande no topo de toda tela do painel enquanto o navegador bloqueia o som. O aviso inteiro é
 * o botão: o toque já libera o áudio (e toca o pedido que esperava). Fica acima dos modais do
 * painel (z 100): é o aviso mais urgente da tela e precisa estar sempre ao alcance do dedo.
 */
export function AvisoSomBloqueado() {
  const alarme = useAlarme()
  if (!alarme || !alarme.ativo || !alarme.somAtivo || !alarme.bloqueado) return null
  const espera = alarme.pendentes[0]
  return (
    <button
      type="button"
      onClick={() => void alarme.testar()}
      data-testid="som-bloqueado"
      data-pedido-esperando={espera ? 'sim' : 'nao'}
      className={`relative z-[100] flex min-h-[56px] w-full flex-shrink-0 items-center justify-center gap-3 bg-[#B91C1C] px-4 py-3 text-center text-[16px] font-semibold leading-snug text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] hover:bg-[#991B1B] focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-white ${espera ? 'animate-pulse' : ''}`}
    >
      <span aria-hidden="true" className="text-[22px]">🔔</span>
      <span>
        {espera
          ? `Pedido novo #${espera.numero} esperando — toque aqui para ativar o som de novos pedidos`
          : 'Toque aqui para ativar o som de novos pedidos'}
      </span>
    </button>
  )
}
