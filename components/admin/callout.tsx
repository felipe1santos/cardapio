'use client'

import type { LucideIcon } from 'lucide-react'
import { Info } from 'lucide-react'

/**
 * Faixa de aviso do painel: fundo azul muito claro, borda azul, ícone à
 * esquerda e, quando há o que fazer, um botão à direita.
 *
 * É o formato para recado que orienta sem assustar — diferente do amarelo de
 * atenção e do vermelho de erro, que continuam existindo para o que atrapalha a
 * operação.
 */
export function Callout({
  titulo,
  children,
  icone: Icone = Info,
  acao,
}: {
  titulo: string
  children?: React.ReactNode
  icone?: LucideIcon
  /** Só aparece quando há um destino real — botão sem destino é promessa vazia. */
  acao?: { rotulo: string; onClick?: () => void; href?: string }
}) {
  const corpo = (
    <>
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--adm-azul-claro,#eff6ff)] text-[var(--adm-azul,#0b78d0)]">
        <Icone className="h-4 w-4" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-[var(--adm-texto,#101828)]">{titulo}</p>
        {children && (
          <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--adm-texto-suave,#667085)]">{children}</div>
        )}
      </div>
    </>
  )

  const classeBotao =
    'inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-[var(--adm-raio-sm,6px)] bg-[var(--adm-azul,#0b78d0)] px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--adm-azul-escuro,#0961a8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--adm-azul,#0b78d0)]'

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--adm-raio,8px)] border border-[#BFDBFE] bg-[var(--adm-azul-claro,#eff6ff)] px-4 py-3">
      {corpo}
      {acao?.href && (
        <a href={acao.href} target="_blank" rel="noopener noreferrer" className={classeBotao}>
          {acao.rotulo}
        </a>
      )}
      {acao?.onClick && !acao.href && (
        <button type="button" onClick={acao.onClick} className={classeBotao}>
          {acao.rotulo}
        </button>
      )}
    </div>
  )
}
