'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

/** Moldura dos modais de CSV dos clientes: centro da tela, rodapé fixo; tela cheia no celular. */
export function ModalCsv({ titulo, subtitulo, onFechar, children, rodape, largura = 760, testid }: {
  titulo: string
  subtitulo?: string
  onFechar: () => void
  children: React.ReactNode
  rodape?: React.ReactNode
  largura?: number
  testid: string
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 sm:items-center sm:p-4" onMouseDown={onFechar}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onMouseDown={(e) => e.stopPropagation()} data-testid={testid}
        className="flex h-full w-full flex-col overflow-hidden bg-white sm:h-auto sm:max-h-[92vh] sm:rounded-[8px] sm:shadow-[0_24px_64px_rgba(15,23,42,0.28)]" style={{ maxWidth: largura }}>
        <header className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-[#e5e7eb] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-[#1f2937]">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 text-[12.5px] text-[#6b7280]">{subtitulo}</p>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[5px] text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#1f2937]"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <footer className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#e5e7eb] bg-white px-5 py-3">{rodape}</footer>}
      </div>
    </div>
  )
}

export const BTN = {
  pri: 'inline-flex h-10 items-center justify-center gap-2 rounded-[5px] bg-[#0688d4] px-4 text-[13px] font-semibold text-white hover:bg-[#0570ae] disabled:cursor-not-allowed disabled:opacity-50',
  sec: 'inline-flex h-10 items-center justify-center gap-2 rounded-[5px] border border-[#d6dae1] bg-white px-4 text-[13px] font-semibold text-[#374151] hover:border-[#0688d4] hover:text-[#0688d4] disabled:opacity-50',
  link: 'text-[12.5px] font-semibold text-[#0688d4] hover:underline',
}

/** Baixa um texto como arquivo (no navegador). */
export function baixarArquivo(conteudo: string | Blob, nome: string, tipo = 'text/csv;charset=utf-8') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const tamanhoLegivel = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB` : `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`)
