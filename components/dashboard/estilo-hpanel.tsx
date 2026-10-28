'use client'

import { useId } from 'react'

/**
 * Peças no visual dos cartões de uso da VPS no hPanel (28/10): roxo #673DE6, trilho lilás,
 * número grande com o complemento pequeno em cinza. Usadas nas Análises do período.
 */
export const ROXO = '#673DE6'
const TRILHO = '#EFEBFD'

/** Anel fino que começa no topo e anda no sentido horário. */
export function AnelHpanel({ pct, tamanho = 72, rotulo }: { pct: number; tamanho?: number; rotulo: string }) {
  const v = Math.max(0, Math.min(100, pct))
  const esp = 7
  const r = (tamanho - esp) / 2, c = tamanho / 2
  const circ = 2 * Math.PI * r
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-label={`${rotulo}: ${Math.round(v)}%`} className="flex-shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke={TRILHO} strokeWidth={esp} />
      {v > 0 && (
        <circle cx={c} cy={c} r={r} fill="none" stroke={ROXO} strokeWidth={esp} strokeDasharray={`${(v / 100) * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />
      )}
    </svg>
  )
}

/** Cartão de métrica com anel: rótulo, valor grande, complemento pequeno e o anel à direita. */
export function CartaoAnel({ rotulo, valor, complemento, pct, detalhe, testid }: {
  rotulo: string; valor: string; complemento?: string; pct: number; detalhe?: string; testid?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[#E4E7EA] bg-white px-4 py-3.5" data-testid={testid}>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-[#1D1E20]">{rotulo}</p>
        <p className="mt-1.5 whitespace-nowrap text-[20px] font-semibold leading-tight text-[#1D1E20]">
          {valor}
          {complemento && <span className="ml-1 text-[12.5px] font-normal text-[#6D7081]">{complemento}</span>}
        </p>
        {detalhe && <p className="mt-0.5 truncate text-[11.5px] text-[#6D7081]">{detalhe}</p>}
      </div>
      <AnelHpanel pct={pct} rotulo={rotulo} />
    </div>
  )
}

/**
 * Colunas verticais roxas: traço de 2px no topo e corpo em degradê (20% → 4%), como a área dos
 * gráficos do hPanel. O valor fica em cima de cada coluna e o nome embaixo.
 */
export function ColunasHpanel({ itens, formatar, altura = 220, testid }: {
  itens: { id: string; rotulo: string; valor: number; dica?: string }[]
  formatar: (n: number) => string
  altura?: number
  testid?: string
}) {
  const id = `ch-${useId().replace(/:/g, '')}`
  const maior = Math.max(1, ...itens.map((i) => i.valor))
  return (
    <div className="overflow-x-auto [scrollbar-width:thin]" data-testid={testid}>
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={ROXO} stopOpacity="0.32" />
            <stop offset="1" stopColor={ROXO} stopOpacity="0.06" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex min-w-full items-end gap-2 border-b border-[#E4E7EA] px-1" style={{ height: altura, minWidth: itens.length * 64 }}>
        {itens.map((i) => {
          const h = Math.max(4, (i.valor / maior) * (altura - 28))
          return (
            <div key={i.id} className="flex min-w-[52px] flex-1 flex-col items-center justify-end" title={i.dica ?? `${i.rotulo}: ${formatar(i.valor)}`}>
              <span className="mb-1 text-[12px] font-semibold tabular-nums text-[#1D1E20]">{formatar(i.valor)}</span>
              <svg width="100%" height={h} preserveAspectRatio="none" viewBox={`0 0 10 ${h}`} className="block max-w-[56px]" aria-hidden="true">
                <rect x="0" y="0" width="10" height={h} fill={`url(#${id})`} />
                <line x1="0" x2="10" y1="1" y2="1" stroke={ROXO} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )
        })}
      </div>
      <div className="flex min-w-full gap-2 px-1 pt-1.5" style={{ minWidth: itens.length * 64 }}>
        {itens.map((i) => (
          <span key={i.id} className="min-w-[52px] flex-1 truncate text-center text-[11.5px] text-[#6D7081]" title={i.rotulo}>{i.rotulo}</span>
        ))}
      </div>
    </div>
  )
}
