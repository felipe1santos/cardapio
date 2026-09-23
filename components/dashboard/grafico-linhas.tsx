'use client'

import { useId, useMemo, useState } from 'react'

/**
 * Gráfico de linhas do Dashboard — o mesmo desenho do "Análise de visitas" da
 * referência: grade horizontal fina, eixo com os valores à esquerda, datas
 * embaixo, um ponto por leitura e legenda no rodapé.
 *
 * Em SVG puro, sem biblioteca de gráfico: o CLAUDE.md pede isso (§3, "gráficos
 * em SVG nativo"), e um pacote de 500 KB para desenhar três linhas sairia caro
 * numa tela que o dono abre o dia inteiro.
 *
 * O SVG tem tamanho fixo em unidades de usuário e escala por `viewBox` — o que
 * mantém o traço fino em qualquer largura sem recalcular nada no JavaScript.
 */
export interface SerieGrafico {
  nome: string
  cor: string
  valores: number[]
}

const L = 780
const A = 300
const MARGEM = { topo: 14, dir: 14, baixo: 34, esq: 40 }

function caminho(valores: number[], escalaX: (i: number) => number, escalaY: (v: number) => number): string {
  return valores.map((v, i) => `${i === 0 ? 'M' : 'L'}${escalaX(i).toFixed(1)},${escalaY(v).toFixed(1)}`).join(' ')
}

/** Passo "redondo" para a régua: 1, 2, 5, 10, 20, 50… conforme o máximo. */
function passoDaGrade(max: number): number {
  if (max <= 4) return 1
  const bruto = max / 4
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)))
  const normalizado = bruto / potencia
  const escolhido = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 5 ? 5 : 10
  return escolhido * potencia
}

export function GraficoLinhas({
  series,
  rotulos,
  formatarValor = (v) => v.toLocaleString('pt-BR'),
  altura = 300,
}: {
  series: SerieGrafico[]
  /** Um rótulo por ponto (datas). */
  rotulos: string[]
  formatarValor?: (v: number) => string
  altura?: number
}) {
  const id = useId()
  const [emFoco, setEmFoco] = useState<number | null>(null)

  const { escalaX, escalaY, linhasGrade, maximo } = useMemo(() => {
    const pontos = Math.max(1, rotulos.length)
    const bruto = Math.max(1, ...series.flatMap((s) => s.valores))
    const passo = passoDaGrade(bruto)
    const maximo = Math.ceil(bruto / passo) * passo
    const larguraUtil = L - MARGEM.esq - MARGEM.dir
    const alturaUtil = A - MARGEM.topo - MARGEM.baixo
    const escalaX = (i: number) => MARGEM.esq + (pontos === 1 ? larguraUtil / 2 : (i / (pontos - 1)) * larguraUtil)
    const escalaY = (v: number) => MARGEM.topo + alturaUtil - (v / maximo) * alturaUtil
    const linhasGrade: number[] = []
    for (let v = 0; v <= maximo; v += passo) linhasGrade.push(v)
    return { escalaX, escalaY, linhasGrade, maximo }
  }, [series, rotulos])

  // Em períodos longos o eixo não cabe: mostra no máximo 8 datas, espaçadas.
  const salto = Math.max(1, Math.ceil(rotulos.length / 8))

  return (
    <div>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        className="w-full"
        style={{ height: altura }}
        role="img"
        aria-label={`Gráfico de linhas: ${series.map((s) => s.nome).join(', ')}`}
      >
        {linhasGrade.map((v) => (
          <g key={v}>
            <line
              x1={MARGEM.esq}
              y1={escalaY(v)}
              x2={L - MARGEM.dir}
              y2={escalaY(v)}
              stroke="#eef0f3"
              strokeWidth={1}
            />
            <text x={MARGEM.esq - 8} y={escalaY(v) + 4} textAnchor="end" fontSize={11} fill="#8a919c">
              {formatarValor(v)}
            </text>
          </g>
        ))}

        {rotulos.map((r, i) =>
          i % salto === 0 || i === rotulos.length - 1 ? (
            <text key={`${r}-${i}`} x={escalaX(i)} y={A - 12} textAnchor="middle" fontSize={11} fill="#8a919c">
              {r}
            </text>
          ) : null,
        )}

        {series.map((s) => (
          <g key={s.nome}>
            <path
              d={caminho(s.valores, escalaX, escalaY)}
              fill="none"
              stroke={s.cor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.valores.map((v, i) => (
              <circle
                key={`${id}-${s.nome}-${i}`}
                cx={escalaX(i)}
                cy={escalaY(v)}
                r={emFoco === i ? 4.5 : 3}
                fill={s.cor}
                stroke="#fff"
                strokeWidth={1.5}
              />
            ))}
          </g>
        ))}

        {/* Faixas invisíveis: dão alvo de mouse para a leitura do dia inteiro,
            em vez de exigir acerto no ponto de 3px. */}
        {rotulos.map((r, i) => (
          <rect
            key={`alvo-${r}-${i}`}
            x={escalaX(i) - (L - MARGEM.esq - MARGEM.dir) / (2 * Math.max(1, rotulos.length - 1))}
            y={MARGEM.topo}
            width={(L - MARGEM.esq - MARGEM.dir) / Math.max(1, rotulos.length - 1)}
            height={A - MARGEM.topo - MARGEM.baixo}
            fill="transparent"
            onMouseEnter={() => setEmFoco(i)}
            onMouseLeave={() => setEmFoco(null)}
          >
            <title>{`${r}: ${series.map((s) => `${s.nome} ${formatarValor(s.valores[i] ?? 0)}`).join(' · ')}`}</title>
          </rect>
        ))}

        {maximo === 1 && series.every((s) => s.valores.every((v) => v === 0)) && (
          <text x={L / 2} y={A / 2} textAnchor="middle" fontSize={13} fill="#b0b6c0">
            Sem dados no período
          </text>
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
        {series.map((s) => (
          <span key={s.nome} className="flex items-center gap-1.5 text-[12px] text-[var(--adm-texto-medio)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.cor }} />
            {s.nome}
          </span>
        ))}
      </div>
    </div>
  )
}
