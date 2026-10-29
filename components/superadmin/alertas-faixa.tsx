'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import { lerTextoAlerta } from '@/lib/saude/texto-alerta'

/**
 * Alertas do sistema no Super Admin (29/10/2026): faixa em vermelho escuro; ao tocar, mostra EXATAMENTE o que foi
 * alertado, por quê (quanto) e o que fazer, com hora e por onde o aviso saiu. Só exibição.
 */
export interface AlertaTela { id?: number | string; criado_em: string; nivel: string; texto: string; canal?: string | null; enviado?: boolean; erro?: string | null }

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const NIVEL: Record<string, [string, string]> = {
  vermelho: ['Crítico', 'bg-[#B3122D] text-white'], amarelo: ['Atenção', 'bg-[#FFF8E2] text-[#8A6100]'],
  resumo: ['Resumo do dia', 'bg-[#EBE4FF] text-[#673DE6]'], teste: ['Teste', 'bg-[#F2F3F6] text-[#58585E]'],
}

/** Um alerta em partes: o que aconteceu, quanto, o que fazer. */
export function DetalheAlerta({ a }: { a: AlertaTela }) {
  const p = lerTextoAlerta(a.texto)
  const [rotulo, cor] = NIVEL[a.nivel] ?? NIVEL.teste
  return (
    <article className="rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[14px] sm:p-[16px]" data-testid="detalhe-alerta">
      <div className="mb-[6px] flex flex-wrap items-center gap-[8px] text-[12px] leading-[16px]">
        <span className={`rounded-[8px] px-[8px] py-[2px] font-semibold ${cor}`}>{rotulo}</span>
        <span className="text-[#58585E]">{quando(a.criado_em)}</span>
        {a.enviado !== undefined && <span className="text-[#58585E]">· {a.enviado ? `avisado por ${a.canal}` : 'não entregue'}</span>}
      </div>
      <h3 className="text-[15px] font-semibold leading-[22px] text-[#18181A] first-letter:uppercase">{p.titulo}</h3>
      <dl className="mt-[6px] grid gap-[6px] text-[14px] leading-[20px]">
        {p.oQue && <div><dt className="text-[12px] font-semibold text-[#58585E]">O que aconteceu</dt><dd className="text-[#18181A]">{p.oQue}</dd></div>}
        {p.quanto && <div><dt className="text-[12px] font-semibold text-[#58585E]">Por quê (o número)</dt><dd className="font-semibold text-[#18181A]">{p.quanto}</dd></div>}
        {p.fazer && <div><dt className="text-[12px] font-semibold text-[#58585E]">O que fazer</dt><dd className="text-[#18181A]">{p.fazer}</dd></div>}
      </dl>
      {a.erro && <p className="mt-[8px] break-words text-[12px] leading-[16px] text-[#B3122D]">Falha no envio: {a.erro}</p>}
    </article>
  )
}

export function AlertasFaixa({ alertas }: { alertas: AlertaTela[] }) {
  const [aberto, setAberto] = useState(false)
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    window.addEventListener('keydown', esc)
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = antes }
  }, [aberto])
  if (!alertas.length) return null
  const p = lerTextoAlerta(alertas[0].texto)
  return (
    <>
      <button type="button" id="alertas" onClick={() => setAberto(true)} data-testid="faixa-alertas" aria-haspopup="dialog"
        className="flex min-h-[48px] w-full items-center gap-[10px] rounded-[16px] bg-[#B3122D] px-[14px] py-[10px] text-left text-white shadow-[0_6px_18px_rgba(179,18,45,0.25)] hover:bg-[#9A0F27] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B3122D]">
        <AlertTriangle className="h-[20px] w-[20px] flex-shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold leading-[20px]">{alertas.length} alerta(s) nas últimas 6 h</span>
          <span className="block truncate text-[13px] leading-[18px] text-white/90 first-letter:uppercase">{p.titulo}{p.quanto ? ` — ${p.quanto}` : ''}</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-[2px] text-[13px] font-semibold">Ver detalhes <ChevronRight className="h-[16px] w-[16px]" aria-hidden /></span>
      </button>

      {aberto && (
        <div className="fixed inset-0 z-[9000] flex items-stretch justify-center bg-[rgba(24,24,26,0.55)] sm:items-center sm:p-[16px]" onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(false) }}>
          <div role="dialog" aria-modal="true" aria-label="Alertas do sistema" data-testid="modal-alertas"
            className="flex h-full w-full max-w-[640px] flex-col bg-[#F5F5F6] sm:h-auto sm:max-h-[88vh] sm:rounded-[24px]">
            <div className="flex flex-shrink-0 items-center gap-[8px] border-b-[0.8px] border-[rgba(0,0,0,0.1)] bg-white px-[16px] py-[12px] sm:rounded-t-[24px]">
              <h2 className="min-w-0 flex-1 text-[16px] font-semibold leading-[24px] text-[#18181A]">Alertas das últimas 6 h</h2>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar" className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-[#58585E] hover:bg-[#F5F5F6]"><X className="h-[20px] w-[20px]" aria-hidden /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-[10px] overflow-y-auto p-[12px] sm:p-[16px]">
              {alertas.map((a, i) => <DetalheAlerta key={a.id ?? i} a={a} />)}
              <a href="/superadmin/saude#alertas" className="block py-[8px] text-center text-[14px] font-semibold text-[#673DE6] hover:underline">Ver histórico completo na Saúde do sistema</a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
