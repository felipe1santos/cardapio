'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Pop-up padrão da tela Impressão: janela central no computador, folha de baixo no
 * celular. Esc, o X e o toque fora fecham. O foco fica preso dentro da janela enquanto
 * ela está aberta e volta para onde estava ao fechar. Conteúdo rola por dentro; rodapé
 * fixo para os botões.
 */
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ModalBase({
  titulo,
  subtitulo,
  onFechar,
  children,
  rodape,
  testid,
  largura = 'max-w-lg',
  acaoTopo,
}: {
  titulo: string
  subtitulo?: React.ReactNode
  onFechar: () => void
  children: React.ReactNode
  rodape?: React.ReactNode
  testid?: string
  largura?: string
  acaoTopo?: React.ReactNode
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const fechar = useRef(onFechar)
  fechar.current = onFechar
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    const el = caixa.current
    const primeiro = el?.querySelector<HTMLElement>('[data-foco-inicial]') ?? el?.querySelector<HTMLElement>(FOCAVEIS)
    primeiro?.focus()
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar.current(); return }
      if (e.key !== 'Tab' || !el) return
      const itens = [...el.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((x) => x.offsetParent !== null)
      if (!itens.length) return
      const i = itens.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); itens[itens.length - 1].focus() }
      else if (!e.shiftKey && i === itens.length - 1) { e.preventDefault(); itens[0].focus() }
    }
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('keydown', tecla)
      antes?.focus?.()
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f172a]/45 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo} data-testid={testid} onClick={onFechar}>
      <div ref={caixa} className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[14px] bg-white shadow-2xl sm:rounded-[12px] ${largura}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[var(--adm-texto)]">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-[13px] text-[var(--adm-texto-suave)]">{subtitulo}</p>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {acaoTopo}
            <button type="button" onClick={onFechar} aria-label="Fechar janela" className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] text-[var(--adm-texto-suave)] hover:bg-[#F3F4F6] hover:text-[var(--adm-texto)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {rodape && <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] px-4 py-3 sm:px-5">{rodape}</div>}
      </div>
    </div>
  )
}
