'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, X } from 'lucide-react'

/**
 * Peças reaproveitáveis do Financeiro (Fase 4). O redesign completo do módulo vem depois; estas peças
 * são o ponto de troca: selo, chip de filtro, painel lateral (tela cheia no celular) e documento de impressão.
 * Seguem as regras do painel: cores vivas com texto claro, camadas por cima (z alto, portal).
 */

/** Selo de status com fundo vivo e texto branco (contraste ≥ 4,5:1). */
export function Selo({ cor, children, testid }: { cor: string; children: React.ReactNode; testid?: string }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-[4px] px-2 py-[3px] text-[11.5px] font-semibold text-white" style={{ backgroundColor: cor }} data-testid={testid}>
      {children}
    </span>
  )
}

/** Chip de filtro (liga/desliga). */
export function Chip({ ativo, onClick, children, testid }: { ativo: boolean; onClick: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} data-testid={testid}
      className={`flex h-[34px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12.5px] font-semibold transition-colors ${ativo ? 'bg-[#1F2937] text-white' : 'border border-border bg-white text-text-main hover:bg-page'}`}>
      {children}
    </button>
  )
}

/**
 * Painel lateral por cima de tudo (portal): à direita no computador, tela cheia com "← Voltar" no celular.
 * Fecha com Esc e no X/Voltar.
 */
export function PainelLateral({ titulo, subtitulo, onFechar, children, acoes, largura = 820, testid }: {
  titulo: React.ReactNode; subtitulo?: React.ReactNode; onFechar: () => void; children: React.ReactNode; acoes?: React.ReactNode; largura?: number; testid?: string
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[9000] flex justify-end bg-[rgba(17,24,39,0.45)]" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar() }}>
      <aside role="dialog" aria-modal="true" aria-label={typeof titulo === 'string' ? titulo : 'Detalhe'} data-testid={testid}
        className="flex h-full w-full flex-col bg-white shadow-[0_0_40px_rgba(15,23,42,0.3)]" style={{ maxWidth: largura }}>
        <header className="flex flex-shrink-0 items-start gap-2 border-b border-border px-4 py-3 sm:px-5">
          <button type="button" onClick={onFechar} className="-ml-1 flex h-[40px] flex-shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[13px] font-semibold text-primary sm:hidden" data-testid="painel-voltar">
            <ArrowLeft className="h-5 w-5" /> Voltar
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-bold text-text-main">{titulo}</h2>
            {subtitulo && <div className="text-[12.5px] text-text-subtle">{subtitulo}</div>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="hidden h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[4px] text-text-subtle hover:bg-page sm:flex" data-testid="painel-fechar">
            <X className="h-5 w-5" />
          </button>
        </header>
        {acoes && <div className="flex flex-shrink-0 flex-wrap gap-2 border-b border-border px-4 py-2.5 sm:px-5">{acoes}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}

/** Imprime um documento (PDF pelo "Salvar como PDF" do navegador), em A4 paisagem, sem o painel em volta. */
export function imprimirDocumento() {
  document.body.classList.add('imprimindo-fluxo')
  const limpar = () => { document.body.classList.remove('imprimindo-fluxo'); window.removeEventListener('afterprint', limpar) }
  window.addEventListener('afterprint', limpar)
  setTimeout(() => window.print(), 50)
}

/** Raiz do documento de impressão (só aparece na impressão). */
export function RaizImpressao({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(<div id="fluxo-print-root" data-testid="fluxo-impressao">{children}</div>, document.body)
}

export const BOTAO = {
  primario: 'inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[4px] bg-[#0369A1] px-3.5 text-[12px] font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-50',
  neutro: 'inline-flex h-[38px] items-center justify-center gap-1.5 rounded-[4px] border border-border bg-white px-3.5 text-[12px] font-semibold uppercase tracking-wide text-text-main hover:bg-page disabled:opacity-50',
}
