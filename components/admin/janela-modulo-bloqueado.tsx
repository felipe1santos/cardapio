'use client'

import { useEffect } from 'react'
import { ICONES } from '@/lib/icones-painel'
import { INFO_MODULO, linkQueroLiberar, type Modulo } from '@/lib/modulos'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * Módulo pago bloqueado (0176): janela no centro com o nome do módulo, o que ele faz e "Quero liberar", que abre o
 * WhatsApp comercial da Menuzia com a mensagem pronta. Usada pelo item com cadeado do menu e pela tela
 * /admin/modulo-bloqueado (quem digita a URL do módulo).
 */
export function JanelaModuloBloqueado({ modulo, loja, whatsapp, onFechar, inline = false }: { modulo: Modulo; loja: string; whatsapp?: string; onFechar?: () => void; /** Cartão no meio da tela (sem fundo escuro), para abas de Ajustes. */ inline?: boolean }) {
  const info = INFO_MODULO[modulo]
  useEffect(() => {
    if (!onFechar) return
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [onFechar])
  const link = linkQueroLiberar(whatsapp || SUPORTE_MENUZIA.whatsapp, modulo, loja || 'minha loja')
  return (
    <div className={inline ? 'flex justify-center py-6' : 'fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4'} onClick={onFechar} data-esc-local="" data-testid="janela-modulo-bloqueado" data-modulo={modulo}>
      <div role="dialog" aria-modal="true" aria-labelledby="modulo-bloqueado-titulo" className="w-full max-w-[400px] rounded-[3px] border border-border bg-white p-6 text-center shadow-[0_20px_50px_rgba(0,0,0,0.25)]" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 grid h-[48px] w-[48px] place-items-center rounded-full bg-[#E0F2FE] text-[#0369A1]">
          <svg viewBox="0 0 24 24" className="h-[24px] w-[24px] fill-current" aria-hidden="true">{ICONES.cadeado.map((d) => <path key={d} d={d} />)}</svg>
        </div>
        <h2 id="modulo-bloqueado-titulo" className="text-[17px] font-semibold text-text-main">{info.nome}</h2>
        <p className="mt-1.5 text-[13.5px] leading-[20px] text-text-subtle">{info.frase}</p>
        <p className="mt-3 text-[12.5px] text-text-subtle">Este módulo ainda não está liberado na sua loja.</p>
        <a href={link} target="_blank" rel="noreferrer" className="mt-4 flex h-[42px] w-full items-center justify-center rounded-[3px] bg-[#16A34A] text-[12px] font-semibold uppercase tracking-wide text-white hover:brightness-110" data-testid="quero-liberar">
          Quero liberar
        </a>
        {onFechar && (
          <button type="button" onClick={onFechar} className="mt-2 h-[38px] w-full rounded-[3px] text-[12px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-[#F3F4F6]" data-testid="modulo-bloqueado-fechar">
            Agora não
          </button>
        )}
      </div>
    </div>
  )
}
