'use client'

import { useEffect, useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'

/** Tela cheia do navegador (Fullscreen API). O navegador pode recusar; aí nada acontece. */
export function useTelaCheia() {
  const [ativa, setAtiva] = useState(false)
  useEffect(() => {
    const aoMudar = () => setAtiva(Boolean(document.fullscreenElement))
    aoMudar()
    document.addEventListener('fullscreenchange', aoMudar)
    return () => document.removeEventListener('fullscreenchange', aoMudar)
  }, [])
  async function alternar() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch {
      /* navegador bloqueou: segue em janela normal */
    }
  }
  return { ativa, alternar }
}

/**
 * Botão de tela cheia. No celular vira só o ícone (quadrado de toque de 40px); do
 * `sm` para cima mostra o texto.
 */
export function BotaoTelaCheia({ className = '' }: { className?: string }) {
  const { ativa, alternar } = useTelaCheia()
  return (
    <button
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
  )
}
