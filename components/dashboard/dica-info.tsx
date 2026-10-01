'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Ícone ⓘ discreto com um texto de apoio: aparece ao passar o mouse (ou focar pelo teclado) e,
 * no toque, abre e fecha. Fecha no Escape e no toque fora.
 */
export function DicaInfo({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('pointerdown', fora)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', fora)
      window.removeEventListener('keydown', esc)
    }
  }, [aberto])

  return (
    // Mouse: abre ao passar por cima. Toque/teclado: o clique abre e fecha (sem o hover simulado do celular).
    <span
      ref={caixa}
      className="relative flex-shrink-0"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setAberto(true) }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAberto(false) }}>
      <button
        type="button"
        onClick={(e) => { if ((e.nativeEvent as PointerEvent).pointerType !== 'mouse') setAberto((v) => !v) }}
        aria-label="Sobre as métricas da vitrine"
        aria-expanded={aberto}
        className="flex h-[36px] w-[36px] items-center justify-center rounded-full text-[var(--adm-texto-suave)] transition-colors hover:bg-[var(--adm-superficie-2)] hover:text-[var(--adm-texto-medio)]"
        data-dashboard-info
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
          <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
        </svg>
      </button>
      {aberto && (
        <span
          role="tooltip"
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-[min(300px,calc(100vw-40px))] rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white px-3 py-2.5 text-[12.5px] leading-[17px] text-[var(--adm-texto-medio)] shadow-[0_8px_24px_rgba(16,24,40,0.12)] sm:left-0 sm:right-auto"
          data-dashboard-info-texto
        >
          {texto}
        </span>
      )}
    </span>
  )
}
