'use client'

import { useId, useMemo } from 'react'

/**
 * Área única — o gráfico de faturamento do período.
 *
 * Mesma régua e mesma grade do gráfico de linhas, com o preenchimento em
 * degradê que a referência usa nos blocos cheios. Fica separado do de linhas
 * porque o que ele mostra é dinheiro: a régua é formatada em reais e existe uma
 * área sob a curva, que em três linhas sobrepostas viraria borrão.
 */
const L = 780
const A = 260
const MARGEM = { topo: 14, dir: 14, baixo: 32, esq: 58 }

function passoDaGrade(max: number): number {
  if (max <= 4) return 1
  const bruto = max / 4
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)))
  const n = bruto / potencia
  const escolhido = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return escolhido * potencia
}

export function GraficoArea({
  valores,
  rotulos,
  cor = 'var(--adm-grafico)',
  formatarValor,
  altura = 260,
}: {
  valores: number[]
  rotulos: string[]
  cor?: string
  formatarValor: (v: number) => string
  altura?: number
}) {
  const id = useId()
  const gradiente = `area-${id.replace(/[:]/g, '')}`

  const { linha, area, escalaX, escalaY, grade } = useMemo(() => {
    const pontos = Math.max(1, valores.length)
    const bruto = Math.max(1, ...valores)
    const passo = passoDaGrade(bruto)
    const maximo = Math.ceil(bruto / passo) * passo
    const larguraUtil = L - MARGEM.esq - MARGEM.dir
    const alturaUtil = A - MARGEM.topo - MARGEM.baixo
    const escalaX = (i: number) => MARGEM.esq + (pontos === 1 ? larguraUtil / 2 : (i / (pontos - 1)) * larguraUtil)
    const escalaY = (v: number) => MARGEM.topo + alturaUtil - (v / maximo) * alturaUtil
    const d = valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${escalaX(i).toFixed(1)},${escalaY(v).toFixed(1)}`).join(' ')
    const base = MARGEM.topo + alturaUtil
    const area = valores.length
      ? `${d} L${escalaX(valores.length - 1).toFixed(1)},${base} L${escalaX(0).toFixed(1)},${base} Z`
      : ''
    const grade: number[] = []
    for (let v = 0; v <= maximo; v += passo) grade.push(v)
    return { linha: d, area, escalaX, escalaY, grade }
  }, [valores])

  const salto = Math.max(1, Math.ceil(rotulos.length / 8))

  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="w-full" style={{ height: altura }} role="img" aria-label="Faturamento no período">
      <defs>
        <linearGradient id={gradiente} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={cor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {grade.map((v) => (
        <g key={v}>
          <line x1={MARGEM.esq} y1={escalaY(v)} x2={L - MARGEM.dir} y2={escalaY(v)} stroke="#eef0f3" strokeWidth={1} />
          <text x={MARGEM.esq - 8} y={escalaY(v) + 4} textAnchor="end" fontSize={11} fill="#8a919c">
            {formatarValor(v)}
          </text>
        </g>
      ))}

      {area && <path d={area} fill={`url(#${gradiente})`} />}
      {linha && <path d={linha} fill="none" stroke={cor} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
      {valores.map((v, i) => (
        <circle key={i} cx={escalaX(i)} cy={escalaY(v)} r={3} fill={cor} stroke="#fff" strokeWidth={1.5}>
          <title>{`${rotulos[i] ?? ''}: ${formatarValor(v)}`}</title>
        </circle>
      ))}

      {rotulos.map((r, i) =>
        i % salto === 0 || i === rotulos.length - 1 ? (
          <text key={`${r}-${i}`} x={escalaX(i)} y={A - 10} textAnchor="middle" fontSize={11} fill="#8a919c">
            {r}
          </text>
        ) : null,
      )}
    </svg>
  )
}
