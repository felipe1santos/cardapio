'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Vídeo em loop da vitrine (21/10/2026): mudo, em loop, sem tela cheia no iPhone (playsInline). A capa aparece
 * primeiro; o arquivo só é pedido quando o vídeo entra na tela e para quando sai. Economia de dados ligada ou
 * "reduzir movimento" no aparelho: fica só a capa (nada é baixado além dela).
 *
 * Rolagem sem travar (26/10/2026). Medido na Menuzia: depois de rolar o cardápio, os 11 vídeos ficavam todos
 * carregados (720×1280 decodificados para quadros de 120–150 px) e cada um que passava pela tela dava play.
 * Agora: (1) no máximo MAX_TOCANDO tocam juntos — o mais antigo pausa e volta à capa; (2) só começa depois de
 * ficar ESPERA_MS visível, então o que passa voando na rolagem nem inicia; (3) longe da tela (mais de uma
 * altura) o vídeo é descarregado e libera o decodificador; voltando, carrega de novo.
 */
const MAX_TOCANDO = 2
const ESPERA_MS = 300
const tocando: HTMLVideoElement[] = []

function soltar(el: HTMLVideoElement) {
  const i = tocando.indexOf(el)
  if (i >= 0) tocando.splice(i, 1)
}

function tocar(el: HTMLVideoElement) {
  soltar(el)
  while (tocando.length >= MAX_TOCANDO) tocando.shift()?.pause()
  tocando.push(el)
  el.play().catch(() => soltar(el))
}

function soCapa(): boolean {
  if (typeof window === 'undefined') return true
  const conexao = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return conexao?.saveData === true
    || window.matchMedia?.('(prefers-reduced-data: reduce)').matches === true
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function VideoLoop({ url, capa, alt, className = '', style }: { url: string; capa: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null)
  // carregado = o <video> tem src (decodificador em uso). Vira false quando o vídeo fica longe da tela.
  const [carregado, setCarregado] = useState(false)
  const [estatico, setEstatico] = useState(true)
  // Quer tocar assim que o src estiver no elemento (o React o coloca no render seguinte ao setCarregado).
  const querTocar = useRef(false)

  useEffect(() => { setEstatico(soCapa()) }, [])

  // Na tela: espera ESPERA_MS e toca (respeitando o limite). Fora: pausa.
  useEffect(() => {
    const el = ref.current
    if (!el || estatico || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | null = null
    const io = new IntersectionObserver(([e]) => {
      if (timer) { clearTimeout(timer); timer = null }
      if (e.isIntersecting) {
        timer = setTimeout(() => {
          querTocar.current = true
          if (el.getAttribute('src')) tocar(el)
          else setCarregado(true)
        }, ESPERA_MS)
      } else {
        querTocar.current = false
        el.pause()
        soltar(el)
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => { if (timer) clearTimeout(timer); io.disconnect(); el.pause(); soltar(el) }
  }, [estatico])

  // Longe da tela (mais de uma altura acima ou abaixo): descarrega.
  useEffect(() => {
    const el = ref.current
    if (!el || estatico || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => { if (!e.isIntersecting) setCarregado(false) }, { rootMargin: '100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [estatico])

  // Carregou: toca se ainda estiver na tela. Descarregou: sem src, o load() devolve o decodificador e a
  // memória do vídeo ao aparelho.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (carregado) { if (querTocar.current) tocar(el) }
    else if (el.getAttribute('src') === null && el.currentSrc) { soltar(el); el.load() }
  }, [carregado])

  if (estatico) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={capa} alt={alt} loading="lazy" decoding="async" className={className} style={style} />
  }
  return (
    <video
      ref={ref}
      src={carregado ? url : undefined}
      poster={capa}
      muted
      loop
      playsInline
      preload="none"
      aria-label={alt}
      disablePictureInPicture
      data-testid="video-loop"
      className={className}
      style={style}
    />
  )
}
