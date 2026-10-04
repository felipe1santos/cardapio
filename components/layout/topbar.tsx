'use client'

import { useContext } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MenuLateralContext } from './menu-lateral-contexto'
import { ICONES } from '@/lib/icones-painel'
import { AcoesTopo } from '@/components/admin/acoes-topo'

export interface TopBarProps {
  title: string
  breadcrumb: string
  /** Ações da tela. No celular descem para uma segunda linha; os botões do sistema não. */
  right?: React.ReactNode
  /**
   * Controles da tela (ex.: Painel de Pedidos), alinhados à esquerda, logo depois do título
   * (ou no lugar dele, com `semTitulo`).
   */
  controles?: React.ReactNode
  /** Botões do sistema próprios da tela (ex.: avisos do Kanban): ficam no grupo da direita. */
  sistema?: React.ReactNode
  /** Título só para leitor de tela: a tela se explica pelos controles. */
  semTitulo?: boolean
  /** Botão de voltar no canto superior esquerdo (telas de detalhe). */
  voltar?: { rotulo: string; onClick: () => void }
}

/**
 * Barra de topo do painel. Regra permanente (2026-10-03): os botões do sistema (avisos, caixa,
 * impressora, Dúvidas, perfil) ficam SEMPRE à direita, na primeira linha, sem quebrar. O que
 * não cabe é a tela que cede: o título encolhe (reticências) e, no celular, as ações da tela
 * descem para uma segunda linha.
 */
export function TopBar({ title, breadcrumb, right, voltar, controles, sistema, semTitulo }: TopBarProps) {
  // Abaixo de `lg` a sidebar é gaveta, e é a barra de topo que a abre. O contexto evita
  // passar a função por todas as telas do painel só para chegar aqui.
  const menu = useContext(MenuLateralContext)

  return (
    <header
      className="flex min-h-[var(--adm-topo,56px)] flex-shrink-0 flex-wrap items-center gap-x-[4px] gap-y-1.5 border-b border-[var(--adm-borda,#e5e7eb)] bg-[var(--adm-superficie,#fff)] px-3 py-[6px] sm:gap-x-2 sm:px-5 md:flex-nowrap"
      data-testid="topo"
    >
      <div className="order-1 flex min-w-0 flex-1 items-center gap-[4px] sm:gap-2" data-testid="topo-esquerda">
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
            className="-ml-1 flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-menuzia text-text-subtle hover:bg-page hover:text-text-main sm:h-[44px] sm:w-[44px] lg:hidden"
            onClick={menu.abrir}
            aria-label="Abrir o menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              {ICONES.menu.map((d) => (<path key={d} d={d} />))}
            </svg>
          </button>
        )}
        {/* Título da referência: uma linha só, 19,2px em peso 500. O caminho
            ("Visão geral › Desempenho") fica só para o leitor de tela. */}
        <div className={semTitulo ? 'sr-only' : 'min-w-0'}>
          <h1 className="truncate text-[19.2px] font-medium leading-tight text-[var(--adm-texto,#1f2937)]">{title}</h1>
          <span className="sr-only">{breadcrumb}</span>
        </div>
        {controles && (
          <div
            className={`flex min-w-0 flex-nowrap items-center gap-[4px] sm:gap-[8px] ${semTitulo ? '' : 'sm:ml-2 sm:border-l sm:border-[var(--adm-borda,#e5e7eb)] sm:pl-4'}`}
            data-testid="topo-controles"
          >
            {controles}
          </div>
        )}
      </div>
      {right && (
        <div className="order-3 flex min-w-0 basis-full flex-wrap items-center justify-end gap-1.5 md:order-2 md:basis-auto md:flex-shrink-0 md:flex-nowrap md:gap-2" data-testid="topo-acoes">
          {right}
        </div>
      )}
      <div className="order-2 flex flex-shrink-0 items-center gap-[4px] md:order-3 sm:gap-2" data-testid="topo-sistema">
        {right && <span aria-hidden className="mx-1 hidden h-[28px] w-px bg-[var(--adm-borda,#e5e7eb)] md:block" />}
        {sistema}
        <AcoesTopo />
      </div>
    </header>
  )
}
