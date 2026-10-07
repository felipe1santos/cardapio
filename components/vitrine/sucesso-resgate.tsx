'use client'

import { useEffect } from 'react'

/**
 * Efeito de sucesso do resgate (2026-10-01): check verde que "estala" + 10 confetes feitos
 * com <span> e CSS (transform/opacity), ~1 s, sem biblioteca. Vibração curta no celular.
 * Some sozinho; com "reduzir movimento" aparece parado (app/globals.css).
 */
const CORES = ['#16A34A', '#0369A1', '#F59E0B', '#EF4444', '#A855F7']

export function SucessoResgate({ texto, onFim }: { texto: string; onFim: () => void }) {
  useEffect(() => {
    try { navigator.vibrate?.(35) } catch { /* sem vibração: tudo bem */ }
    const t = setTimeout(onFim, 1100)
    return () => clearTimeout(t)
  }, [onFim])
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center" data-testid="sucesso-resgate" aria-live="polite">
      <div className="relative flex flex-col items-center gap-2 rounded-2xl bg-white/95 px-6 py-5 shadow-2xl">
        {Array.from({ length: 10 }, (_, i) => {
          const ang = (i / 10) * Math.PI * 2
          return (
            <span
              key={i}
              className="efeito-confete absolute left-1/2 top-[34px] h-[8px] w-[5px] rounded-[1px]"
              style={{ backgroundColor: CORES[i % CORES.length], ['--dx' as string]: `${Math.round(Math.cos(ang) * 70)}px`, ['--dy' as string]: `${Math.round(Math.sin(ang) * 55 - 20)}px`, ['--rot' as string]: `${i * 47}deg` }}
            />
          )
        })}
        <span className="efeito-check flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#16A34A]">
          <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white" aria-hidden><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
        </span>
        <span className="text-[14px] font-semibold text-[#15803D]">{texto}</span>
      </div>
    </div>
  )
}
