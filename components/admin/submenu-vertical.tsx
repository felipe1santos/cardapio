'use client'

/**
 * Navegação secundária das seções do painel (Ajustes, Integrações).
 *
 * No desktop é uma coluna à esquerda do conteúdo: com oito destinos, a fila
 * horizontal de abas empurrava os últimos para fora e escondia metade da seção
 * atrás de uma rolagem lateral. Em coluna, tudo fica à vista e o item ativo é
 * óbvio.
 *
 * No celular a coluna não cabe — ali continua o trilho horizontal rolável, que
 * é a solução compacta que já funcionava. Mesma lista, mesmos nomes, mesmas
 * rotas: só muda a forma.
 */
export interface ItemSubmenu<T extends string> {
  id: T
  label: string
  /** Contador discreto (pendências, itens). Zero ou ausente não aparece. */
  contador?: number
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
      className={[
        // Celular: trilho horizontal, rolável, colado no topo da seção.
        'flex flex-shrink-0 gap-1 overflow-x-auto border-b border-[var(--adm-borda)] bg-[var(--adm-superficie)] px-3 py-2',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // Desktop: coluna fixa à esquerda, sem borda de baixo.
        'lg:w-[212px] lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:overflow-x-visible lg:border-b-0 lg:border-r lg:px-2.5 lg:py-3',
      ].join(' ')}
    >
      {itens.map((item) => {
        const selecionado = item.id === ativo
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelecionar(item.id)}
            aria-current={selecionado ? 'page' : undefined}
            className={[
              'flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--adm-raio-sm)] px-3 py-2 text-[13px] transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--adm-azul)]',
              'lg:w-full lg:justify-start',
              selecionado
                ? 'bg-[var(--adm-azul-claro)] font-semibold text-[var(--adm-azul-escuro)]'
                : 'font-medium text-[var(--adm-texto-suave)] hover:bg-[var(--adm-superficie-2)] hover:text-[var(--adm-texto)]',
            ].join(' ')}
          >
            <span className="truncate">{item.label}</span>
            {item.contador !== undefined && item.contador > 0 && (
              <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--adm-azul-claro)] px-1 text-[10px] font-bold text-[var(--adm-azul-escuro)]">
                {item.contador}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
