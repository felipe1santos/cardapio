'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * true enquanto o elemento está na tela (2026-10-01). Os efeitos da vitrine pausam fora
 * dela (`animation-play-state: paused` via data-visivel) para não gastar o celular à toa.
 */
export function useVisivel<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null)
  const [visivel, setVisivel] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisivel(e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, visivel]
}
