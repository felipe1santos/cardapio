'use client'

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
    <div className="flex min-h-[236px] flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
      <div className="flex-1 px-4 pt-4">
        <p className="text-[12.8px] font-semibold text-[var(--adm-texto-forte)]">{etapa.rotulo}</p>
        <p className="mt-1 text-[26px] font-bold leading-none text-[var(--adm-texto)]">
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
        <svg
          viewBox={`0 0 100 ${ALTURA_BLOCO}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <polygon
            points={`0,${esquerda} 100,${direita} 100,${ALTURA_BLOCO} 0,${ALTURA_BLOCO}`}
            fill="var(--adm-funil)"
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 text-white">
          <p className="text-[15px] font-bold leading-none">{etapa.pct}%</p>
          <p className="mt-1 text-[11px] font-medium text-white/90">
            {etapa.pctAnterior === null ? 'das visitas' : `${etapa.pctAnterior}% no período anterior`}
          </p>
        </div>
      </div>
    </div>
  )
}
