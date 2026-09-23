'use client'

import { useContext } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MenuLateralContext } from './menu-lateral-contexto'

export interface TopBarProps {
  title: string
  breadcrumb: string
  right?: React.ReactNode
  /** Botão de voltar no canto superior esquerdo (telas de detalhe). */
  voltar?: { rotulo: string; onClick: () => void }
}

export function TopBar({ title, breadcrumb, right, voltar }: TopBarProps) {
  // Abaixo de `lg` a sidebar é gaveta, e é a barra de topo que a abre. O contexto evita
  // passar a função por todas as telas do painel só para chegar aqui.
  const menu = useContext(MenuLateralContext)

  // Abaixo de sm a barra cresce em vez de empurrar as ações fora da tela: com título e
  // dois ou três botões, 60px fixos não cabem num aparelho de 360px.
  return (
    <header className="flex min-h-[var(--adm-topo,56px)] flex-shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-[var(--adm-borda,#e5e7eb)] bg-[var(--adm-superficie,#fff)] px-3 py-2 sm:h-[var(--adm-topo,56px)] sm:flex-nowrap sm:py-0 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {voltar && (
          <button
            onClick={voltar.onClick}
            aria-label={voltar.rotulo}
            title={voltar.rotulo}
            className="-ml-1 flex h-[44px] flex-shrink-0 items-center gap-1 rounded-menuzia px-2 text-primary hover:bg-primary/10"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="hidden text-[12px] font-bold uppercase tracking-wide sm:inline">{voltar.rotulo}</span>
          </button>
        )}
        {menu && (
          <button
            className="-ml-1 flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-menuzia text-text-subtle hover:bg-page hover:text-text-main lg:hidden"
            onClick={menu.abrir}
            aria-label="Abrir o menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
            </svg>
          </button>
        )}
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-text-main">{title}</div>
          <div className="mt-0.5 truncate text-xs text-text-subtle">{breadcrumb}</div>
        </div>
      </div>
      {right && <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:flex-shrink-0 sm:gap-2">{right}</div>}
    </header>
  )
}
