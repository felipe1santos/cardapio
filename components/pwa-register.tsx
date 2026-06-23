'use client'

import { useEffect } from 'react'

/** Registra o service worker para habilitar a instalação do painel como PWA. */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* registro do SW falhou — o app segue funcionando normalmente */
    })
  }, [])
  return null
}
