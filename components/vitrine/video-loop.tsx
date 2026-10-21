'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Vídeo em loop da vitrine (21/10/2026): mudo, em loop, sem tela cheia no iPhone (playsInline). A capa aparece
 * primeiro; o arquivo só é pedido quando o vídeo entra na tela e para quando sai. Economia de dados ligada ou
 * "reduzir movimento" no aparelho: fica só a capa (nada é baixado além dela).
 */
function soCapa(): boolean {
  if (typeof window === 'undefined') return true
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return conexao?.saveData === true
    || window.matchMedia?.('(prefers-reduced-data: reduce)').matches === true
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function VideoLoop({ url, capa, alt, className = '', style }: { url: string; capa: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ativo, setAtivo] = useState(false)
  const [estatico, setEstatico] = useState(true)

  useEffect(() => { setEstatico(soCapa()) }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || estatico || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setAtivo(true); el.play().catch(() => {}) } else el.pause()
    }, { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [estatico])

  if (estatico) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={capa} alt={alt} loading="lazy" decoding="async" className={className} style={style} />
  }
  return (
    <video
      ref={ref}
      src={ativo ? url : undefined}
      poster={capa}
      muted
      loop
      playsInline
      autoPlay={ativo}
      preload="none"
      aria-label={alt}
      disablePictureInPicture
      data-testid="video-loop"
      className={className}
      style={style}
    />
  )
}
