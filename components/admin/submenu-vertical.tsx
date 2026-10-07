'use client'

import { IconeMaterial, type NomeIconeMaterial } from '@/components/icones/material'

/**
 * Navegação secundária das seções do painel (Ajustes, Campanhas, Fidelidade, Financeiro).
 *
 * Visual do submenu-modelo do dono (2026-10-06): fonte Nunito (arredondada, guardada no projeto,
 * peso máximo 600), ícone Material PREENCHIDO cinza à esquerda do texto e o item ativo com fundo
 * cinza-claro arredondado. O menu lateral principal não usa este componente e não muda.
 *
 * No desktop é uma coluna à esquerda do conteúdo; no celular, um trilho horizontal rolável no topo
 * da seção. Mesma lista, mesmos nomes, mesmas rotas: só muda a forma.
 */
export interface ItemSubmenu<T extends string> {
  id: T
  label: string
  /** Contador discreto (pendências, itens). Zero ou ausente não aparece. */
  contador?: number
  /** Nome do ícone Material preenchido (ou um nó pronto). */
  icone?: NomeIconeMaterial | React.ReactNode
  /** Título pequeno de grupo antes deste item (só na coluna do desktop). */
  grupo?: string
}

export function SubmenuVertical<T extends string>({
  itens,
  ativo,
  onSelecionar,
  titulo,
}: {
  itens: ItemSubmenu<T>[]
  ativo: T
  onSelecionar: (id: T) => void
  /** Rótulo do grupo, lido por leitor de tela. */
  titulo: string
}) {
  return (
    <nav
      aria-label={titulo}
      data-submenu=""
      style={{ fontFamily: 'var(--font-submenu), var(--font-painel), system-ui, sans-serif' }}
      className={[
        // Celular: trilho horizontal, rolável, colado no topo da seção.
        'flex flex-shrink-0 gap-1 overflow-x-auto border-b border-[#E5E7EB] bg-white px-3 py-2',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Desktop: coluna fixa à esquerda, sem borda de baixo.
        'lg:w-[256px] lg:flex-col lg:gap-[4px] lg:overflow-y-auto lg:overflow-x-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-4',
      ].join(' ')}
    >
      {itens.map((item) => {
        const selecionado = item.id === ativo
        return (
          <div key={item.id} className="contents">
            {item.grupo && (
              <span className="mt-3 hidden px-3 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6B7280] lg:block">{item.grupo}</span>
            )}
            <button
              type="button"
              onClick={() => onSelecionar(item.id)}
              aria-current={selecionado ? 'page' : undefined}
              data-submenu-item={item.id}
              className={[
                'flex min-h-[40px] flex-shrink-0 items-center gap-[12px] whitespace-nowrap rounded-[8px] px-[12px] py-[8px] text-[14.5px] leading-[20px] transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0688D4]',
                'lg:w-full lg:justify-start',
                selecionado
                  ? 'bg-[#EEF0F3] font-semibold text-[#1F2937]'
                  : 'font-medium text-[#4B5563] hover:bg-[#F6F7F9] hover:text-[#1F2937]',
              ].join(' ')}
            >
              {item.icone && (
                <span aria-hidden className={['flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center [&>svg]:h-[20px] [&>svg]:w-[20px]', selecionado ? 'text-[#374151]' : 'text-[#4B5563]'].join(' ')}>
                  {typeof item.icone === 'string' ? <IconeMaterial nome={item.icone as NomeIconeMaterial} /> : item.icone}
                </span>
              )}
              <span className="truncate">{item.label}</span>
              {item.contador !== undefined && item.contador > 0 && (
                <span className="ml-auto flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#E1EDF7] px-1.5 text-[11px] font-semibold text-[#0868A6]">
                  {item.contador}
                </span>
              )}
            </button>
          </div>
        )
      })}
    </nav>
  )
}
