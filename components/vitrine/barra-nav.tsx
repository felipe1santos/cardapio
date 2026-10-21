'use client'

/**
 * Barra de navegação de baixo da vitrine (21/10/2026), no estilo da referência do dono: fundo na cor principal da loja
 * (Perfil), ícones Phosphor de linha fina e textos brancos. O item ativo fica numa bolha branca que sobe acima da
 * barra, presa por uma curva na mesma cor; ao tocar em outro item a bolha e a curva DESLIZAM até ele.
 * "Reduzir movimento" no aparelho: troca na hora, sem deslizar. Destinos e ações continuam vindo da vitrine.
 */
export interface ItemBarraNav {
  id: string
  label: string
  onClick: () => void
  active: boolean
  icon: React.ReactNode
  /** Número no canto do ícone (prêmios para resgatar). */
  badge?: number
  piscar?: boolean
}

const CURVA_L = 104
const CURVA_A = 20
const BOLHA = 46

export function BarraNav({ itens }: { itens: ItemBarraNav[] }) {
  const ativo = itens.findIndex((i) => i.active)
  const centro = `${((Math.max(ativo, 0) + 0.5) / itens.length) * 100}%`
  const atual = itens[ativo]
  const desliza = 'transition-[left,opacity] duration-[450ms] ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none'

  return (
    <div className="relative flex bg-[var(--tema-primaria)] text-white" data-testid="nav-botoes">
      {/* Curva na cor da barra: sobe em volta da bolha e desliza com ela. */}
      <svg aria-hidden viewBox={`0 0 ${CURVA_L} ${CURVA_A + 2}`} width={CURVA_L} height={CURVA_A + 2}
        className={`pointer-events-none absolute text-[var(--tema-primaria)] ${desliza} ${ativo < 0 ? 'opacity-0' : 'opacity-100'}`}
        style={{ left: `calc(${centro} - ${CURVA_L / 2}px)`, top: -(CURVA_A + 1) }} data-testid="nav-curva">
        <path d={`M0 ${CURVA_A + 2} L0 ${CURVA_A + 1} C24 ${CURVA_A + 1} 26 1 52 1 C78 1 80 ${CURVA_A + 1} ${CURVA_L} ${CURVA_A + 1} L${CURVA_L} ${CURVA_A + 2} Z`} fill="currentColor" />
      </svg>
      {/* Bolha branca com o ícone ativo na cor da loja. */}
      {atual && (
        <span className={`pointer-events-none absolute z-[1] ${desliza}`} style={{ left: `calc(${centro} - ${BOLHA / 2}px)`, top: -(CURVA_A - 3), width: BOLHA, height: BOLHA }} data-testid="nav-bolha">
          <span className="flex h-full w-full items-center justify-center rounded-full bg-white text-[var(--tema-primaria)] shadow-[0_4px_12px_rgba(0,0,0,0.22)] [&_svg]:h-[24px] [&_svg]:w-[24px]">
            {atual.icon}
          </span>
        </span>
      )}
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={item.onClick}
          aria-label={item.label}
          aria-current={item.active ? 'page' : undefined}
          style={item.piscar ? { animation: 'cupons-piscar 0.7s ease-in-out 3' } : undefined}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold text-white"
        >
          <span className={`relative transition-opacity duration-200 motion-reduce:transition-none [&_svg]:h-[22px] [&_svg]:w-[22px] ${item.active ? 'opacity-0' : 'opacity-90'}`}>
            {item.icon}
          </span>
          {!!item.badge && item.badge > 0 && (
            <span className="absolute left-1/2 top-1 ml-[6px] flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[9px] font-semibold leading-none text-[var(--tema-primaria)]">
              {item.badge}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>
  )
}
