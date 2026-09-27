'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

/**
 * Pop-up padrão da tela Impressão: janela central no computador, folha de baixo no
 * celular. Esc e toque fora fecham. Conteúdo rola por dentro; rodapé fixo para os botões.
 */
export function ModalBase({
  titulo,
  subtitulo,
  onFechar,
  children,
  rodape,
  testid,
  largura = 'max-w-lg',
}: {
  titulo: string
  subtitulo?: React.ReactNode
  onFechar: () => void
  children: React.ReactNode
  rodape?: React.ReactNode
  testid?: string
  largura?: string
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f172a]/45 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={titulo} data-testid={testid} onClick={onFechar}>
      <div className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[14px] bg-white shadow-2xl sm:rounded-[8px] ${largura}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--adm-borda)] px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-[var(--adm-texto)]">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-[12.5px] text-[var(--adm-texto-suave)]">{subtitulo}</p>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar janela" className="flex h-[32px] w-[32px] flex-shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[var(--adm-texto-suave)] hover:text-[var(--adm-texto)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {rodape && <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--adm-borda)] px-4 py-3 sm:px-5">{rodape}</div>}
      </div>
    </div>
  )
}
