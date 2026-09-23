'use client'

import { useId } from 'react'

/**
 * Minigráfico (sparkline) da tendência de uma métrica no período.
 *
 * A cor diz a direção contra o período anterior: verde subiu, vermelho caiu,
 * cinza sem base de comparação. É a mesma leitura da seta de variação ao lado,
 * só que mostrando o caminho, não só o saldo.
 */
export function MiniGrafico({
  valores,
  tendencia,
  largura = 96,
  altura = 28,
  className = '',
}: {
  valores: number[]
  /** Variação contra o período anterior; null = sem comparação. */
  tendencia: number | null
  largura?: number
  altura?: number
  className?: string
}) {
  const id = useId().replace(/[:]/g, '')
  if (valores.length < 2 || valores.every((v) => v === 0)) return null

  const cor = tendencia === null || tendencia === 0 ? '#9CA3AF' : tendencia > 0 ? '#10B981' : '#EF4444'
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const faixa = max - min || 1
  const pad = 2
  const x = (i: number) => (i / (valores.length - 1)) * largura
  const y = (v: number) => pad + (1 - (v - min) / faixa) * (altura - pad * 2)
  const linha = valores.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${linha} L${largura},${altura} L0,${altura} Z`

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      width={largura}
      height={altura}
      className={`flex-shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`mg-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity="0.28" />
          <stop offset="100%" stopColor={cor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#mg-${id})`} />
      <path d={linha} fill="none" stroke={cor} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(valores.length - 1)} cy={y(valores[valores.length - 1])} r="2.2" fill={cor} />
    </svg>
  )
}
