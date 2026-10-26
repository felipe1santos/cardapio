'use client'

import { useEffect, useRef } from 'react'

/**
 * Leitura periódica que pausa com a aba escondida e lê na hora ao voltar (revisão de escala, 26/10). Os avisos globais
 * do painel liam a cada 60 s mesmo escondidos — o PC da cozinha fica o dia todo assim, e o egress é pago por requisição.
 * Lê ao montar. `ler` fica numa ref: trocar a função não reinicia o relógio.
 */
export function useLeituraPeriodica(ler: () => void, intervaloMs: number): void {
  const lerRef = useRef(ler)
  lerRef.current = ler

  useEffect(() => {
    const visivel = () => document.visibilityState === 'visible'
    lerRef.current()
    const t = setInterval(() => { if (visivel()) lerRef.current() }, intervaloMs)
    const aoVoltar = () => { if (visivel()) lerRef.current() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [intervaloMs])
}
