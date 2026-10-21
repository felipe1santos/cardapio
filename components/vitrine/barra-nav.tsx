'use client'

/**
 * Barra de navegação de baixo da vitrine (21/10/2026), no estilo da referência do dono: ícones de linha finos e, no
 * item ativo, uma bolha na cor da loja que sobe acima da barra, presa por uma curva. Ao trocar de aba a bolha desliza
 * até o novo ícone e "nasce" de novo de baixo para cima. "Reduzir movimento" no aparelho: troca na hora, sem animação.
 * Os destinos e o que cada botão faz continuam vindo da vitrine — aqui é só o desenho.
 */
export interface ItemBarraNav {
  id: string
  label: string
  onClick: () => void
  active: boolean
  icon: React.ReactNode
  /** Número vermelho no canto do ícone (prêmios para resgatar). */
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
  const desliza = 'transition-[left,opacity] duration-[420ms] ease-[cubic-bezier(.65,0,.35,1)] motion-reduce:transition-none'

  return (
    <div className="relative flex" data-testid="nav-botoes">
      <style>{`@keyframes nav-bolha-sobe{0%{transform:translateY(18px) scale(.55);opacity:.4}70%{transform:translateY(-2px) scale(1.04);opacity:1}100%{transform:translateY(0) scale(1)}}`}</style>
      {/* Curva da barra: sobe em volta da bolha e cobre o fio de cima naquele trecho. */}
      <svg aria-hidden viewBox={`0 0 ${CURVA_L} ${CURVA_A + 2}`} width={CURVA_L} height={CURVA_A + 2}
        className={`pointer-events-none absolute ${desliza} ${ativo < 0 ? 'opacity-0' : 'opacity-100'}`}
        style={{ left: `calc(${centro} - ${CURVA_L / 2}px)`, top: -(CURVA_A + 1) }} data-testid="nav-curva">
        <path d={`M0 ${CURVA_A + 2} L0 ${CURVA_A + 1} C24 ${CURVA_A + 1} 26 1 52 1 C78 1 80 ${CURVA_A + 1} ${CURVA_L} ${CURVA_A + 1} L${CURVA_L} ${CURVA_A + 2} Z`} fill="#fff" />
        <path d={`M0 ${CURVA_A + 0.5} C24 ${CURVA_A + 0.5} 26 0.5 52 0.5 C78 0.5 80 ${CURVA_A + 0.5} ${CURVA_L} ${CURVA_A + 0.5}`} fill="none" stroke="var(--v-borda, #E5E7EB)" strokeWidth="1" />
      </svg>
      {/* Bolha com o ícone ativo, na cor da loja. A key reinicia a animação a cada troca. */}
      {atual && (
        <span className={`pointer-events-none absolute z-[1] ${desliza}`} style={{ left: `calc(${centro} - ${BOLHA / 2}px)`, top: -(CURVA_A - 1), width: BOLHA, height: BOLHA }} data-testid="nav-bolha">
          <span key={atual.id} className="flex h-full w-full items-center justify-center rounded-full bg-[var(--tema-primaria)] text-white shadow-[0_6px_14px_rgba(0,0,0,0.18)] [animation:nav-bolha-sobe_420ms_cubic-bezier(.34,1.3,.64,1)] motion-reduce:[animation:none] [&_svg]:h-[22px] [&_svg]:w-[22px]">
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
          className={['relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors', item.active ? 'text-[var(--tema-primaria)]' : 'text-[#6B7280] hover:text-[var(--v-texto,#1F2937)]'].join(' ')}
        >
          <span className={`relative transition-opacity duration-200 motion-reduce:transition-none ${item.active ? 'opacity-0' : 'opacity-100'}`}>
            {item.icon}
          </span>
          {!!item.badge && item.badge > 0 && (
            <span className="absolute left-1/2 top-1 ml-[6px] flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[9px] font-semibold leading-none text-white">
              {item.badge}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>
  )
}
