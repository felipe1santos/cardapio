'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { MessageCircle } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import type { PropsCentral } from '@/components/atendimento/central'

/**
 * Botão flutuante da central de atendimento do WhatsApp (canto inferior direito).
 *
 * LEVE de propósito: fechado, só existe este botão com o número (conversas aguardando +
 * não lidas). O painel inteiro (central.tsx) é carregado sob demanda, no clique.
 * Contador: uma assinatura Realtime em whatsapp_conversas da loja que só dispara uma
 * contagem (com 800 ms de folga); sem Realtime, contagem a cada 25 s — nos dois casos,
 * parada enquanto a aba está escondida. Contador no título da aba e som opcional.
 */
const CHAVE_SOM = 'menuzia.atendimento.som'

function tocarAviso() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, ctx.currentTime)
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.34)
    setTimeout(() => void ctx.close(), 500)
  } catch {
    /* sem áudio: tudo bem */
  }
}

export function LancadorAtendimento({ restauranteId }: { restauranteId: string }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [resumo, setResumo] = useState<{ aguardando: number; naoLidas: number } | null>(null)
  const [aberto, setAberto] = useState(false)
  // Minimizado: o painel continua montado (conversa aberta e texto digitado ficam) e o botão volta.
  const [minimizado, setMinimizado] = useState(false)
  const [Central, setCentral] = useState<ComponentType<PropsCentral> | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [pulso, setPulso] = useState(false)
  const [som, setSom] = useState(true)
  const anterior = useRef<number | null>(null)
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try { setSom(localStorage.getItem(CHAVE_SOM) !== '0') } catch { /* padrão: ligado */ }
  }, [])
  const alternarSom = useCallback((v: boolean) => {
    setSom(v)
    try { localStorage.setItem(CHAVE_SOM, v ? '1' : '0') } catch { /* só preferência */ }
  }, [])

  const contar = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    const r = await fetch('/api/admin/whatsapp/atendimento/resumo', { cache: 'no-store' }).catch(() => null)
    if (!r || !r.ok) return setResumo(null)
    setResumo(await r.json())
  }, [])
  const agendar = useCallback(() => {
    if (espera.current) clearTimeout(espera.current)
    espera.current = setTimeout(() => void contar(), 800)
  }, [contar])

  // Uma assinatura Realtime (ou polling de 25 s sem ela), pausada com a aba escondida.
  useEffect(() => {
    void contar()
    let tempoReal = false
    const canal = supabase
      .channel(`atendimento-contador-${restauranteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversas', filter: `restaurante_id=eq.${restauranteId}` }, () => agendar())
      .subscribe((status) => { tempoReal = status === 'SUBSCRIBED' })
    const t = setInterval(() => { if (!tempoReal) void contar() }, 25_000)
    const visivel = () => { if (!document.hidden) void contar() }
    document.addEventListener('visibilitychange', visivel)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', visivel)
      if (espera.current) clearTimeout(espera.current)
      void supabase.removeChannel(canal)
    }
  }, [supabase, restauranteId, contar, agendar])

  const total = resumo ? resumo.aguardando + resumo.naoLidas : 0

  // Chegou algo novo: animação curta e, se ligado, o som.
  useEffect(() => {
    if (!resumo) return
    if (anterior.current !== null && total > anterior.current) {
      setPulso(true)
      setTimeout(() => setPulso(false), 1600)
      if (som) tocarAviso()
    }
    anterior.current = total
  }, [resumo, total, som])

  // Contador no título da aba.
  useEffect(() => {
    const limpo = document.title.replace(/^\(\d+\) /, '')
    document.title = total > 0 ? `(${total}) ${limpo}` : limpo
  }, [total])
  useEffect(() => () => { document.title = document.title.replace(/^\(\d+\) /, '') }, [])

  async function abrir() {
    setAberto(true)
    setMinimizado(false)
    if (Central) return
    setCarregando(true)
    try {
      const m = await import('@/components/atendimento/central')
      setCentral(() => m.CentralAtendimento)
    } finally {
      setCarregando(false)
    }
  }

  if (!resumo) return null
  const botaoVisivel = !aberto || minimizado

  return (
    <>
      {botaoVisivel && (
        <button
          type="button"
          onClick={() => void abrir()}
          aria-label={total ? `Atendimento WhatsApp: ${resumo.aguardando} aguardando, ${resumo.naoLidas} com mensagem nova` : 'Abrir atendimento WhatsApp'}
          title="Atendimento WhatsApp"
          data-testid="atendimento-lancador"
          className={['fixed bottom-4 right-4 z-40 flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_6px_20px_rgba(15,23,42,0.25)] transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]', pulso ? 'animate-bounce' : ''].join(' ')}
        >
          <MessageCircle className="h-[26px] w-[26px]" strokeWidth={2.2} />
          {total > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border-2 border-white bg-[#DC2626] px-1 text-[11.5px] font-bold tabular-nums" data-testid="atendimento-badge">
              {total > 99 ? '99+' : total}
            </span>
          )}
        </button>
      )}
      {aberto && carregando && !Central && (
        <div className="fixed bottom-4 right-4 z-40 flex h-[54px] items-center gap-2 rounded-full bg-white px-4 text-[13px] text-[#4B5563] shadow-lg" role="status">Abrindo atendimento…</div>
      )}
      {aberto && Central && (
        <Central
          restauranteId={restauranteId}
          som={som}
          onSom={alternarSom}
          oculto={minimizado}
          onMinimizar={() => { setMinimizado(true); void contar() }}
          onFechar={() => { setAberto(false); setMinimizado(false); void contar() }}
          onMudou={agendar}
          filtroInicial={resumo.aguardando > 0 ? 'aguardando' : 'todas'}
        />
      )}
    </>
  )
}
