'use client'

import { useEffect, useState } from 'react'
import type { EtapaFunilVitrine } from '@/lib/dashboard-metricas'

/**
 * Funil da vitrine em trapézios (28/10, no desenho do "Funil por tipo de campanha" do Gestor Ads):
 * tempo até cada etapa à esquerda, a etapa no meio e pessoas · taxa à direita; resumo ao lado.
 * É a segunda forma de ver os mesmos números dos cartões roxos — o dono escolhe qual usar.
 */
// Do azul claro ao forte, uma cor por etapa.
const CORES = ['#CDE2FB', '#B0CFF5', '#8EBAEF', '#6DA7EC', '#4F94E6']
// Largura mínima: a última etapa continua legível mesmo com conversão baixa.
const PISO = 40

function largura(qtd: number, base: number): number {
  if (!base) return PISO
  return PISO + (100 - PISO) * Math.sqrt(Math.min(1, qtd / base))
}

const pct = (q: number, b: number) => (b ? `${(Math.round((q / b) * 1000) / 10).toLocaleString('pt-BR')}%` : '—')

export function FunilEtapas({ etapas, tempos, tempoTotal }: {
  etapas: EtapaFunilVitrine[]
  /** Tempo médio desde a etapa anterior, já formatado (a primeira não tem). */
  tempos: (string | null)[]
  tempoTotal: string | null
}) {
  // Trapézios crescem do centro ao abrir, um depois do outro.
  const [pronto, setPronto] = useState(false)
  useEffect(() => {
    const q = requestAnimationFrame(() => setPronto(true))
    return () => cancelAnimationFrame(q)
  }, [])

  const base = etapas[0]?.qtd ?? 0
  const pedidos = etapas[etapas.length - 1]?.qtd ?? 0
  const sacola = etapas.find((e) => e.id === 'sacola')?.qtd ?? 0

  return (
    <section className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-4" data-testid="funil-etapas">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_88px] gap-2 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--adm-texto-suave)] sm:grid-cols-[110px_minmax(0,1fr)_150px] sm:gap-3">
            <span className="text-right">Tempo</span>
            <span className="text-center">Etapa</span>
            <span>Pessoas · taxa</span>
          </div>
          <ol className="flex flex-col gap-[7px]">
            {etapas.map((e, i) => (
              <li key={e.id} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-2 sm:grid-cols-[110px_minmax(0,1fr)_150px] sm:gap-3" data-testid={`funil-etapa-${e.id}`}>
                <div className="text-right leading-tight">
                  <p className="text-[13px] font-semibold text-[var(--adm-texto)]">{i === 0 ? '—' : tempos[i] ?? '—'}</p>
                  <p className="text-[11px] text-[var(--adm-texto-suave)]">{i === 0 ? 'início' : 'desde a anterior'}</p>
                </div>
                <div className="flex justify-center">
                  <div
                    className="flex h-11 items-center justify-center rounded-[8px] px-3 text-center text-[#0F172A] transition-[width,filter] duration-700 ease-out hover:brightness-95 motion-reduce:transition-none"
                    style={{
                      width: pronto ? `${largura(e.qtd, base)}%` : '0%',
                      transitionDelay: pronto ? `${i * 90}ms` : '0ms',
                      background: CORES[i] ?? CORES[CORES.length - 1],
                      clipPath: 'polygon(0 0, 100% 0, 96% 100%, 4% 100%)',
                    }}
                  >
                    <span className="truncate text-[12.5px] font-semibold">{e.rotulo}</span>
                  </div>
                </div>
                <div className="leading-tight">
                  <p className="text-[15px] font-semibold text-[var(--adm-texto)]">{e.qtd.toLocaleString('pt-BR')}</p>
                  <p className="text-[11px] text-[var(--adm-texto-suave)]">
                    {i === 0 ? e.descricao : `${pct(e.qtd, etapas[i - 1].qtd)} da etapa anterior`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-2.5">
          <Resumo rotulo="Conversão total" valor={pct(pedidos, base)} ajuda="Pedidos sobre visitas" destaque />
          <Resumo rotulo="Visita até o pedido" valor={tempoTotal ?? '—'} ajuda="Soma dos tempos médios entre as etapas" />
          <Resumo rotulo="Sacolas que viraram pedido" valor={pct(pedidos, sacola)} ajuda={`${(sacola - pedidos > 0 ? sacola - pedidos : 0).toLocaleString('pt-BR')} sacolas sem pedido`} />
          <p className="text-[11px] leading-[16px] text-[var(--adm-texto-suave)]">
            Cada visitante conta uma vez por etapa. O tempo é a média entre uma etapa e a seguinte.
          </p>
        </div>
      </div>
    </section>
  )
}

function Resumo({ rotulo, valor, ajuda, destaque = false }: { rotulo: string; valor: string; ajuda: string; destaque?: boolean }) {
  return (
    <div className="rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] px-3.5 py-2.5">
      <p className="text-[11.5px] text-[var(--adm-texto-medio)]">{rotulo}</p>
      <p className={`text-[19px] font-semibold leading-tight ${destaque ? 'text-[var(--adm-alta)]' : 'text-[var(--adm-texto)]'}`}>{valor}</p>
      <p className="text-[11px] text-[var(--adm-texto-suave)]">{ajuda}</p>
    </div>
  )
}
