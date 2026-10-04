'use client'

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, HelpCircle, X } from 'lucide-react'
import { Dica } from '@/components/ui/flutuante'

/** Peças comuns da área de Campanhas (repaginação 2026-10). Só aparência. */

export const STATUS_CAMPANHA: Record<string, { rotulo: string; fundo: string; cor: string }> = {
  rascunho: { rotulo: 'Rascunho', fundo: '#F1F5F9', cor: '#475569' },
  agendada: { rotulo: 'Agendada', fundo: '#E0F2FE', cor: '#0369A1' },
  enviando: { rotulo: 'Enviando', fundo: '#FEF3C7', cor: '#B45309' },
  pausada: { rotulo: 'Pausada', fundo: '#FEF3C7', cor: '#B45309' },
  concluida: { rotulo: 'Processada', fundo: '#DCFCE7', cor: '#15803D' },
  concluida_com_falhas: { rotulo: 'Processada com falhas', fundo: '#FFEDD5', cor: '#C2410C' },
  falhou: { rotulo: 'Falhou', fundo: '#FEE2E2', cor: '#B91C1C' },
  cancelada: { rotulo: 'Cancelada', fundo: '#FEE2E2', cor: '#B91C1C' },
}

export function SeloStatusCampanha({ status }: { status: string }) {
  const s = STATUS_CAMPANHA[status] ?? { rotulo: status, fundo: '#F1F5F9', cor: '#475569' }
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[4px] px-2 py-[3px] text-[11.5px] font-semibold" style={{ backgroundColor: s.fundo, color: s.cor }} data-testid="status-campanha" data-status={status}>
      {s.rotulo}
    </span>
  )
}

/** Ícone (?) com explicação no hover/foco/toque — por cima de tudo (Dica compartilhada). */
export function Ajuda({ texto }: { texto: string }) {
  return (
    <span className="relative inline-flex">
      <Dica texto={texto} alternarNoClique largura={240}>
        <button type="button" aria-label={texto} className="flex h-5 w-5 items-center justify-center rounded-full text-[#9ca3af] hover:text-[#0688d4]" data-toque-livre>
          <HelpCircle className="h-[15px] w-[15px]" />
        </button>
      </Dica>
    </span>
  )
}

/** "Registros por página", faixa e setas. */
export function Paginacao({ total, pagina, porPagina, onPagina, onPorPagina }: {
  total: number
  pagina: number
  porPagina: number
  onPagina: (p: number) => void
  onPorPagina: (n: number) => void
}) {
  const ultima = Math.max(0, Math.ceil(total / porPagina) - 1)
  const de = total === 0 ? 0 : pagina * porPagina + 1
  const ate = Math.min(total, (pagina + 1) * porPagina)
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 border-t border-[#eef0f3] px-4 py-2.5 text-[12.5px] text-[#5b6472]" data-testid="paginacao">
      <label className="flex items-center gap-2">
        Registros por página
        <select value={porPagina} onChange={(e) => { onPorPagina(Number(e.target.value)); onPagina(0) }} className="campanha-select-mini" data-testid="por-pagina">
          {[10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span data-testid="faixa">{de}–{ate} de {total}</span>
      <span className="flex gap-1">
        <button type="button" className="campanha-seta" disabled={pagina === 0} onClick={() => onPagina(pagina - 1)} aria-label="Página anterior" data-testid="pagina-anterior"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" className="campanha-seta" disabled={pagina >= ultima} onClick={() => onPagina(pagina + 1)} aria-label="Próxima página" data-testid="pagina-proxima"><ChevronRight className="h-4 w-4" /></button>
      </span>
    </div>
  )
}

/** Ilustração própria do estado vazio (megafone com ondas, traço azul Menuzia). */
export function IlustracaoVazio() {
  return (
    <svg viewBox="0 0 160 110" className="h-[96px] w-[140px]" aria-hidden>
      <rect x="18" y="86" width="124" height="6" rx="3" fill="#EEF2F6" />
      <path d="M44 46h14l34-18v52L58 62H44a6 6 0 0 1-6-6V52a6 6 0 0 1 6-6z" fill="#E0F2FE" stroke="#0688D4" strokeWidth="3" strokeLinejoin="round" />
      <path d="M52 62l6 18h10l-4-17" fill="#fff" stroke="#0688D4" strokeWidth="3" strokeLinejoin="round" />
      <path d="M104 44c5 4 5 16 0 20M112 36c10 8 10 28 0 36" fill="none" stroke="#9FD3F2" strokeWidth="3" strokeLinecap="round" />
      <circle cx="126" cy="24" r="4" fill="#A855F7" opacity=".5" />
      <circle cx="30" cy="28" r="3" fill="#10B981" opacity=".5" />
    </svg>
  )
}

/** Janela de confirmação no lugar do confirm() do navegador. */
export function Confirmar({ titulo, texto, botao, perigo, onCancelar, onConfirmar }: {
  titulo: string
  texto: string
  botao: string
  perigo?: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onCancelar])
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={onCancelar}>
      <div role="dialog" aria-modal="true" className="w-full max-w-[420px] overflow-hidden rounded-[8px] bg-white shadow-[0_24px_64px_rgba(15,23,42,0.28)]" onMouseDown={(e) => e.stopPropagation()} data-testid="confirmar">
        <div className="flex h-[52px] items-center justify-between border-b border-[#e5e7eb] px-5">
          <span className="text-[15px] font-bold text-[#1f2937]">{titulo}</span>
          <button type="button" onClick={onCancelar} aria-label="Fechar" className="text-[#6b7280] hover:text-[#1f2937]"><X className="h-5 w-5" /></button>
        </div>
        <p className="p-5 text-[13.5px] leading-relaxed text-[#374151]">{texto}</p>
        <div className="flex justify-end gap-2 border-t border-[#e5e7eb] px-5 py-3">
          <button type="button" className="h-10 rounded-[5px] border border-[#d6dae1] px-4 text-[13px] font-semibold text-[#374151] hover:bg-[#f3f4f6]" onClick={onCancelar}>Voltar</button>
          <button type="button" className={`h-10 rounded-[5px] px-4 text-[13px] font-semibold text-white ${perigo ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-[#0688d4] hover:bg-[#0570ae]'}`} onClick={onConfirmar} data-testid="confirmar-ok">{botao}</button>
        </div>
      </div>
    </div>
  )
}

/** Texto com {variáveis} destacadas. */
export function TextoComVariaveis({ texto, className = '' }: { texto: string; className?: string }) {
  const partes = texto.split(/(\{[a-z_]+\})/g)
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {partes.map((p, i) => (/^\{[a-z_]+\}$/.test(p) ? <span key={i} className="rounded-[3px] bg-[#E0F2FE] px-1 font-semibold text-[#0570AE]" data-variavel>{p}</span> : <span key={i}>{p}</span>))}
    </span>
  )
}

export function formatarDataHora(iso: string | null, comAno = true): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', ...(comAno ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' })
}

export function formatarDiaSemana(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)}, ${d.toLocaleDateString('pt-BR')}`
}
