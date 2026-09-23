'use client'

import { ICONES } from '@/lib/icones-painel'
import { textoVariacao, type EtapaFunil } from '@/lib/dashboard-metricas'

/**
 * Cartão de etapa do funil, no desenho da referência: título, número grande,
 * uma linha dizendo o que aquilo significa, a variação contra o período
 * anterior e, no rodapé, um bloco colorido cuja altura é a participação da
 * etapa. Lado a lado, os blocos desenham o funil sem precisar de gráfico.
 *
 * A cor é a mesma em todos os cartões de propósito: o que diferencia é a
 * ALTURA. Pintar cada etapa de uma cor sugeriria significado que não existe.
 */
export function CartaoFunil({ etapa }: { etapa: EtapaFunil }) {
  const variacao = textoVariacao(etapa.variacao)
  const subiu = (etapa.variacao ?? 0) > 0
  // Piso de 12% para a última etapa continuar visível quando a conversão é baixa.
  const altura = Math.max(12, Math.min(100, etapa.pct))

  return (
    <div className="flex min-h-[190px] flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
      <div className="flex-1 p-4">
        <p className="text-[12.8px] font-bold text-[var(--adm-texto-forte)]">{etapa.rotulo}</p>
        <p className="mt-1 text-[28px] font-bold leading-none text-[var(--adm-texto)]">
          {etapa.qtd.toLocaleString('pt-BR')}
        </p>
        <p className="mt-1.5 text-[11px] text-[var(--adm-texto-suave)]">{etapa.descricao}</p>
        {variacao && (
          <p
            className={[
              'mt-2 flex items-center gap-1 text-[11px] font-semibold',
              subiu ? 'text-[var(--adm-alta)]' : 'text-[var(--adm-baixa)]',
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
              {(subiu ? ICONES.subindo : ICONES.caindo).map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            {variacao} vs. período anterior
          </p>
        )}
      </div>
      <div
        className="flex flex-col justify-end px-4 py-3 text-white"
        style={{
          height: `${altura}%`,
          minHeight: 64,
          backgroundColor: 'var(--adm-grafico)',
        }}
      >
        <p className="text-[15px] font-bold leading-none">{etapa.pct}%</p>
        <p className="mt-1 text-[11px] text-white">da primeira etapa</p>
      </div>
    </div>
  )
}
