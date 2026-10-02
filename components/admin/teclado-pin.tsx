'use client'

import { useEffect } from 'react'

/**
 * Teclado de PIN (6 dígitos) — tela travada, troca de operador e, na Fase 2, aprovação do
 * gerente. Aceita também o teclado físico. O PIN nunca fica guardado fora deste estado.
 */
export function TecladoPin({
  valor,
  onMudar,
  onCompleto,
  ocupado,
  erro,
}: {
  valor: string
  onMudar: (v: string) => void
  onCompleto: (pin: string) => void
  ocupado?: boolean
  erro?: string | null
}) {
  const tocar = (d: string) => {
    if (ocupado || valor.length >= 6) return
    const novo = valor + d
    onMudar(novo)
    if (novo.length === 6) onCompleto(novo)
  }
  const apagar = () => { if (!ocupado) onMudar(valor.slice(0, -1)) }

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); tocar(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); apagar() }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  })

  return (
    <div className="select-none" data-testid="teclado-pin">
      <div className="mb-[14px] flex justify-center gap-[10px]" aria-label={`${valor.length} de 6 dígitos`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`h-[14px] w-[14px] rounded-full border-2 ${i < valor.length ? 'border-[#0688D4] bg-[#0688D4]' : 'border-[#9CA3AF]'}`} />
        ))}
      </div>
      {erro && <p role="alert" className="mb-[10px] text-center text-[13px] font-medium text-[#EF4444]" data-testid="pin-erro">{erro}</p>}
      <div className="mx-auto grid w-[240px] grid-cols-3 gap-[8px]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => tocar(d)} disabled={ocupado} data-testid={`pin-${d}`}
            className="h-[56px] rounded-[3px] border border-[#E5E7EB] bg-white text-[22px] font-semibold text-[#1F2937] hover:bg-[#EDEEF1] disabled:opacity-50">
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => tocar('0')} disabled={ocupado} data-testid="pin-0"
          className="h-[56px] rounded-[3px] border border-[#E5E7EB] bg-white text-[22px] font-semibold text-[#1F2937] hover:bg-[#EDEEF1] disabled:opacity-50">
          0
        </button>
        <button type="button" onClick={apagar} disabled={ocupado} aria-label="Apagar"
          className="h-[56px] rounded-[3px] text-[13px] font-semibold uppercase tracking-wide text-[#6B7280] hover:bg-[#EDEEF1] disabled:opacity-50">
          Apagar
        </button>
      </div>
    </div>
  )
}
