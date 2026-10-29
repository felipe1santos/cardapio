'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

/**
 * Botão "i" do Super Admin (29/10/2026): abre uma explicação curta do que é aquele número/bloco. Clique (não hover —
 * funciona no celular), fecha no Esc e no clique fora; área de toque de 44 px; aria-expanded/aria-controls.
 */
export function InfoHp({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const id = useId()
  const caixa = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent | TouchEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('touchstart', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('touchstart', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])
  return (
    <span ref={caixa} className="relative inline-flex">
      <button type="button" aria-label={`O que é: ${titulo}`} aria-expanded={aberto} aria-controls={id}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberto((v) => !v) }}
        className="-m-[10px] inline-flex h-[44px] w-[44px] items-center justify-center rounded-full text-[#58585E] hover:text-[#673DE6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#673DE6]">
        <Info className="h-[16px] w-[16px]" aria-hidden />
      </button>
      {aberto && (
        <span id={id} role="note"
          className="absolute left-1/2 top-[30px] z-50 w-[min(280px,80vw)] -translate-x-1/2 rounded-[12px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[12px] text-left text-[13px] font-normal leading-[20px] text-[#18181A] shadow-[0_12px_32px_rgba(24,24,26,0.16)]">
          <span className="mb-[4px] block text-[13px] font-semibold">{titulo}</span>
          {children}
        </span>
      )}
    </span>
  )
}
