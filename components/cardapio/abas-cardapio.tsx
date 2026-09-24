'use client'

import { Layers, Ruler, ShoppingBag, UtensilsCrossed } from 'lucide-react'

export type AbaCardapio = 'itens' | 'complementos' | 'tamanhos' | 'peca-tambem'

export const ABAS_CARDAPIO: { id: AbaCardapio; rotulo: string; icone: typeof Layers }[] = [
  { id: 'itens', rotulo: 'Itens do cardápio', icone: UtensilsCrossed },
  { id: 'complementos', rotulo: 'Grupos de complementos', icone: Layers },
  { id: 'tamanhos', rotulo: 'Tamanhos', icone: Ruler },
  { id: 'peca-tambem', rotulo: 'Peça também', icone: ShoppingBag },
]

/**
 * Aba vinda da URL. `orderbump` é o nome antigo da aba (link salvo, favorito) e
 * cai em "Peça também"; qualquer outra coisa volta para os itens.
 */
export function abaDaUrl(valor: string | null): AbaCardapio {
  if (valor === 'orderbump') return 'peca-tambem'
  return ABAS_CARDAPIO.some((a) => a.id === valor) ? (valor as AbaCardapio) : 'itens'
}

/** Abas sublinhadas na cor de marca — o mesmo desenho da Logística e do Dashboard. */
export function AbasCardapio({
  ativa,
  contadores,
  onTrocar,
  acessorio,
}: {
  ativa: AbaCardapio
  contadores: Partial<Record<AbaCardapio, number>>
  onTrocar: (aba: AbaCardapio) => void
  acessorio?: React.ReactNode
}) {
  return (
    <div className="flex flex-shrink-0 items-end justify-between gap-3 border-b border-[var(--adm-borda)] bg-white px-5 pt-2.5 max-lg:px-3">
      <div role="tablist" aria-label="Seções do cardápio" className="flex gap-1 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden">
        {ABAS_CARDAPIO.map(({ id, rotulo, icone: Icone }) => {
          const selecionada = ativa === id
          const n = contadores[id]
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selecionada}
              data-testid={`aba-${id}`}
              onClick={() => onTrocar(id)}
              className={[
                '-mb-px flex flex-shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-2.5 pt-1.5 text-[13.5px] transition-colors',
                selecionada
                  ? 'border-[var(--adm-azul)] font-semibold text-[var(--adm-texto)]'
                  : 'border-transparent font-medium text-[var(--adm-texto-suave)] hover:text-[var(--adm-texto)]',
              ].join(' ')}
            >
              <Icone className={`h-4 w-4 ${selecionada ? 'text-[var(--adm-azul)]' : ''}`} strokeWidth={2} />
              {rotulo}
              {n !== undefined && n > 0 && (
                <span
                  className={`min-w-[20px] rounded-full px-1.5 py-[1px] text-center text-[11px] font-bold ${
                    selecionada ? 'bg-[var(--adm-azul)] text-white' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {acessorio && <div className="mb-1.5 flex flex-shrink-0 items-center gap-2 max-lg:hidden">{acessorio}</div>}
    </div>
  )
}
