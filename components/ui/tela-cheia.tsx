'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2 } from 'lucide-react'
import { CAMADA_MAXIMA } from '@/components/ui/flutuante'

/**
 * Tela cheia: a do navegador (Fullscreen API) e, junto, o modo "tela cheia" do painel — a marca
 * `data-tela-cheia` no <html>. No celular (abaixo de 768 px) essa marca esconde o topo do painel e
 * o aviso de impressão (app/globals.css), o que vale até no iPhone, que não tem Fullscreen API.
 * Tablet e desktop: só a do navegador, como antes (a marca não tem regra acima de 768 px).
 */
const EVENTO = 'menuzia:tela-cheia'
let entrouNoNavegador = false

function marcada() {
  return typeof document !== 'undefined' && document.documentElement.dataset.telaCheia === '1'
}
function marcar(ligar: boolean) {
  if (ligar) document.documentElement.dataset.telaCheia = '1'
  else delete document.documentElement.dataset.telaCheia
  window.dispatchEvent(new Event(EVENTO))
}

export function useTelaCheia() {
  const [ativa, setAtiva] = useState(false)
  useEffect(() => {
    const ler = () => setAtiva(Boolean(document.fullscreenElement) || marcada())
    const aoMudarNavegador = () => {
      // Saiu da tela cheia do navegador (Esc, gesto): sai do modo do painel também.
      if (!document.fullscreenElement && entrouNoNavegador) { entrouNoNavegador = false; if (marcada()) marcar(false) }
      ler()
    }
    ler()
    document.addEventListener('fullscreenchange', aoMudarNavegador)
    window.addEventListener(EVENTO, ler)
    return () => { document.removeEventListener('fullscreenchange', aoMudarNavegador); window.removeEventListener(EVENTO, ler) }
  }, [])
  async function alternar() {
    if (document.fullscreenElement || marcada()) {
      marcar(false)
      entrouNoNavegador = false
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* já saiu */ }
      return
    }
    marcar(true)
    try {
      await document.documentElement.requestFullscreen()
      entrouNoNavegador = true
    } catch {
      /* navegador bloqueou (ou não tem, como o iPhone): fica só o modo do painel */
    }
  }
  return { ativa, alternar }
}

/**
 * Botão de tela cheia. No celular vira só o ícone (quadrado de toque de 40px); do
 * `sm` para cima mostra o texto. Quando ele mora no topo do painel e o topo some (tela cheia no
 * celular), aparece um botão flutuante para sair.
 */
export function BotaoTelaCheia({ className = '', flutuante = true }: { className?: string; flutuante?: boolean }) {
  const { ativa, alternar } = useTelaCheia()
  const ref = useRef<HTMLButtonElement>(null)
  const [noTopo, setNoTopo] = useState(false)
  useEffect(() => { setNoTopo(Boolean(ref.current?.closest('[data-testid="topo"]'))) }, [])
  // Sair desta tela desliga o modo: senão a próxima tela (sem este botão) ficaria sem topo.
  useEffect(() => () => { if (marcada()) marcar(false) }, [])
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => void alternar()}
        title={ativa ? 'Sair da tela cheia' : 'Tela cheia (também: tecla F11)'}
        aria-label={ativa ? 'Sair da tela cheia' : 'Tela cheia'}
        data-testid="botao-tela-cheia"
        className={[
          'flex h-[40px] min-w-[40px] flex-shrink-0 items-center justify-center gap-1.5 rounded-menuzia border border-border bg-white px-2.5 text-[12px] font-semibold text-text-main transition-colors hover:border-primary hover:text-primary',
          className,
        ].join(' ')}
      >
        {ativa ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
        <span className="hidden sm:inline">{ativa ? 'Sair da tela cheia' : 'Tela cheia'}</span>
      </button>
      {ativa && noTopo && flutuante && typeof document !== 'undefined' && createPortal(
        <button
          type="button"
          onClick={() => void alternar()}
          aria-label="Sair da tela cheia"
          title="Sair da tela cheia"
          data-testid="sair-tela-cheia"
          className="fixed right-[8px] top-[8px] flex h-[40px] w-[40px] items-center justify-center rounded-menuzia border border-border bg-white/95 text-text-main shadow-md md:hidden"
          style={{ zIndex: CAMADA_MAXIMA }}
        >
          <Minimize2 className="h-4 w-4" aria-hidden />
        </button>,
        document.body,
      )}
    </>
  )
}
