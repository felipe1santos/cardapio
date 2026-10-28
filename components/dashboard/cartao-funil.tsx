'use client'

import { useEffect, useRef } from 'react'
import { ICONES } from '@/lib/icones-painel'
import { textoVariacao, type EtapaFunilVitrine } from '@/lib/dashboard-metricas'
import { MiniGrafico } from '@/components/dashboard/mini-grafico'

/**
 * Cartão de etapa do funil da vitrine: título, número grande, o que ele
 * significa, variação com minigráfico e, no rodapé, o bloco roxo.
 *
 * O topo do bloco é uma RAMPA: começa na altura desta etapa e termina na da
 * seguinte. Lado a lado, os cinco cartões desenham o funil contínuo — dá pra
 * ver onde o cliente desiste sem ler número nenhum.
 *
 * A cor é a mesma em todos de propósito: o que diferencia é a altura.
 *
 * O bloco é um líquido (28/10): ao abrir, chacoalha e vai assentando até
 * parar na rampa. Com "reduzir movimento" do sistema, já aparece parado.
 */
const ALTURA_BLOCO = 112
// Piso para a última etapa continuar visível quando a conversão é baixa.
const PISO = 0.42

function alturaDe(pct: number): number {
  const fracao = Math.min(1, Math.max(0, pct / 100))
  return ALTURA_BLOCO * (PISO + (1 - PISO) * fracao)
}

export function CartaoFunil({ etapa }: { etapa: EtapaFunilVitrine }) {
  const variacao = textoVariacao(etapa.variacao)
  const subiu = (etapa.variacao ?? 0) > 0
  const esquerda = ALTURA_BLOCO - alturaDe(etapa.pct)
  const direita = ALTURA_BLOCO - alturaDe(etapa.pctProxima)

  return (
    <div className="flex min-h-[236px] flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" data-testid={`funil-${etapa.id}`}>
      <div className="flex-1 px-4 pt-4">
        <p className="text-[12.8px] font-semibold text-[var(--adm-texto-forte)]">{etapa.rotulo}</p>
        <p className="mt-1 text-[26px] font-semibold leading-none text-[var(--adm-texto)]">
          {etapa.qtd.toLocaleString('pt-BR')}
        </p>
        <p className="mt-1.5 text-[11px] text-[var(--adm-texto-suave)]">{etapa.descricao}</p>
        <div className="mt-2 flex min-h-[28px] items-center justify-between gap-2">
          {variacao ? (
            <p
              className={[
                'flex items-center gap-1 text-[11px] font-semibold',
                subiu ? 'text-[var(--adm-alta)]' : 'text-[var(--adm-baixa)]',
              ].join(' ')}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                {(subiu ? ICONES.subindo : ICONES.caindo).map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
              {variacao}
            </p>
          ) : (
            <span className="text-[11px] text-[var(--adm-texto-suave)]">sem comparação</span>
          )}
          <MiniGrafico valores={etapa.serie} tendencia={etapa.variacao} largura={72} altura={24} />
        </div>
      </div>

      <div className="relative mt-3" style={{ height: ALTURA_BLOCO }}>
        <Liquido esquerda={esquerda} direita={direita} />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 text-white">
          <p className="text-[15px] font-semibold leading-none">{etapa.pct}%</p>
          <p className="mt-1 text-[11px] font-medium text-white/90">
            {etapa.pctAnterior === null ? 'das visitas' : `${etapa.pctAnterior}% no período anterior`}
          </p>
        </div>
      </div>
    </div>
  )
}

const DURACAO = 4200
// A superfície nunca desce até o texto branco do rodapé (fica legível durante o balanço).
const LIMITE = ALTURA_BLOCO - 44

function superficie(esquerda: number, direita: number, t: number, fase: number): string {
  const s = t / 1000
  const amorte = Math.exp(-s * 1.15)
  let d = ''
  for (let x = 0; x <= 100; x += 4) {
    const u = x / 100
    const base = esquerda + (direita - esquerda) * u
    // Balanço de um lado para o outro + duas ondas cruzadas = turbulência que amortece.
    const balanco = Math.cos(s * 4.2 + fase) * (u - 0.5) * 26
    const ondas = Math.sin(u * 9 - s * 7 + fase) * 5 + Math.sin(u * 17 + s * 5.3 + fase * 2) * 2.5
    const y = Math.min(LIMITE, base + (amorte ? (balanco + ondas) * amorte : 0))
    d += `${x ? 'L' : 'M'}${x},${y.toFixed(2)} `
  }
  return `${d}L100,${ALTURA_BLOCO} L0,${ALTURA_BLOCO} Z`
}

function Liquido({ esquerda, direita }: { esquerda: number; direita: number }) {
  const frente = useRef<SVGPathElement>(null)
  const fundo = useRef<SVGPathElement>(null)

  useEffect(() => {
    const parar = () => {
      frente.current?.setAttribute('d', superficie(esquerda, direita, Infinity, 0))
      fundo.current?.setAttribute('d', superficie(esquerda, direita, Infinity, 0))
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return parar()
    let quadro = 0
    const inicio = performance.now()
    const passo = (agora: number) => {
      const t = agora - inicio
      if (t >= DURACAO) return parar()
      frente.current?.setAttribute('d', superficie(esquerda, direita, t, 0))
      fundo.current?.setAttribute('d', superficie(esquerda, direita, t, 2.1))
      quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [esquerda, direita])

  const repouso = superficie(esquerda, direita, Infinity, 0)
  return (
    <svg
      viewBox={`0 0 100 ${ALTURA_BLOCO}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <path ref={fundo} d={repouso} fill="var(--adm-funil)" opacity="0.35" />
      <path ref={frente} d={repouso} fill="var(--adm-funil)" />
    </svg>
  )
}
