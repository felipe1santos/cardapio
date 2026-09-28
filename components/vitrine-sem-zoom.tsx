'use client'

import { useEffect } from 'react'

/**
 * Zoom de pinça desligado na vitrine do cliente.
 *
 * O viewport (`maximum-scale=1, user-scalable=no`, em app/loja/[slug]/page.tsx)
 * e o `touch-action: pan-x pan-y` (globals.css, `.vitrine-sem-zoom`) resolvem no
 * Android. O Safari do iPhone ignora o `user-scalable=no` desde o iOS 10, e a
 * pinça ainda passaria por lá: estes eventos `gesture*` só existem no Safari e
 * são o único jeito de segurar o zoom nele. Sem `touchmove` não passivo de
 * propósito: ele faria o navegador esperar o JS a cada rolagem.
 *
 * Vale só enquanto a vitrine está montada: o painel, o PDV e as mesas não
 * carregam este componente.
 */
export function VitrineSemZoom() {
  useEffect(() => {
    const segurar = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', segurar, { passive: false })
    document.addEventListener('gesturechange', segurar, { passive: false })
    return () => {
      document.removeEventListener('gesturestart', segurar)
      document.removeEventListener('gesturechange', segurar)
    }
  }, [])
  return null
}
