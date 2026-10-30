import Link from 'next/link'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { custoGoogleMicroUsd } from '@/lib/custo/gasto-lojas'
import type { UsoApis } from '@/lib/custo/uso'
import type { UsoIa } from '@/lib/custo/ia'
import { CabecalhoHp, PainelHp } from './hp'
import { GraficoDiasHp } from './grafico-hp'

/**
 * Gasto das APIs em reais (30/10/2026). Visão geral: só o de HOJE, simples. Aba Gastos de API: o histórico de 7 dias.
 * Google pelo preço de tabela (a mesma conta de lib/custo/gasto-lojas.ts); IA pelo custo real.
 */
const FATURAMENTO_GOOGLE = 'https://console.cloud.google.com/billing/01456B-8C09EE-838D63/reports;timeRange=LAST_30_DAYS;grouping=GROUP_BY_SKU'
const reais = (micro: number, cot: number) => ((micro / 1e6) * cot).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: micro > 0 && micro < 2e5 ? 4 : 2 })
const num = (n: number) => n.toLocaleString('pt-BR')
const custoDe = (api: 'geocoding' | 'directions' | 'maps_js', chamadas: number) => custoGoogleMicroUsd({ geocoding: 0, directions: 0, maps_js: 0, [api]: chamadas })

export function GastoHoje({ uso, ia, cotacao }: { uso: UsoApis | null | undefined; ia: UsoIa | null | undefined; cotacao: number }) {
  const t = uso?.total
  const itens: { rotulo: string; detalhe: string; micro: number; cor: string }[] = [
    { rotulo: 'Endereços (Geocoding)', detalhe: `${num(t?.geocoding ?? 0)} chamadas`, micro: custoDe('geocoding', t?.geocoding ?? 0), cor: '#673DE6' },
    { rotulo: 'Rotas (Directions)', detalhe: `${num(t?.directions ?? 0)} chamadas`, micro: custoDe('directions', t?.directions ?? 0), cor: '#008361' },
    { rotulo: 'Mapas carregados', detalhe: `${num(t?.maps_js ?? 0)} chamadas`, micro: custoDe('maps_js', t?.maps_js ?? 0), cor: '#0B86C9' },
    { rotulo: 'IA de atendimento (Claude)', detalhe: `${num(ia?.hoje.chamadas ?? 0)} respostas`, micro: ia?.hoje.custoMicroUsd ?? 0, cor: '#18181A' },
  ]
  const total = itens.reduce((s, i) => s + i.micro, 0)
  const max = Math.max(1, ...itens.map((i) => i.micro))
  return (
    <PainelHp testid="sa-gasto-hoje">
      <CabecalhoHp titulo="Gasto de API hoje" sub="Google pelo preço de tabela, antes da cota grátis; IA pelo custo real"
        info="Quanto as APIs pagas custaram hoje. O Google só cobra de verdade depois da cota grátis de 10 mil chamadas por serviço no mês. Histórico e gasto por loja ficam na aba Gastos de API."
        acoes={<>
          <a href={FATURAMENTO_GOOGLE} target="_blank" rel="noreferrer" data-testid="link-faturamento-google" className="inline-flex h-[40px] items-center gap-[4px] rounded-[12px] px-[4px] text-[14px] font-bold text-[#673DE6] hover:underline">Faturamento Google <ExternalLink className="h-[14px] w-[14px]" aria-hidden /></a>
          <Link href="/superadmin/gasto" data-testid="link-gasto" className="inline-flex h-[40px] items-center gap-[2px] rounded-[12px] px-[4px] text-[14px] font-bold text-[#673DE6] hover:underline">Ver gastos <ChevronRight className="h-[16px] w-[16px]" aria-hidden /></Link>
        </>} />
      <div className="grid gap-x-[32px] gap-y-[12px] px-[16px] pb-[16px] sm:px-[24px] sm:pb-[20px] lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <div>
          <p className="text-[28px] font-bold leading-[36px] tabular-nums text-[#18181A]" data-testid="sa-gasto-total">{reais(total, cotacao)}</p>
          <p className="text-[13px] leading-[18px] text-[#58585E]">total de hoje</p>
        </div>
        <ul className="m-0 grid list-none gap-x-[32px] gap-y-[10px] p-0 sm:grid-cols-2">
          {itens.map((i) => (
            <li key={i.rotulo} className="min-w-0">
              <div className="flex items-baseline justify-between gap-[8px] text-[13px] leading-[18px]">
                <span className="min-w-0 truncate text-[#18181A]">{i.rotulo}</span>
                <span className="flex-shrink-0 font-semibold tabular-nums text-[#18181A]">{reais(i.micro, cotacao)}</span>
              </div>
              <div className="my-[3px] h-[8px] overflow-hidden rounded-full bg-[#F2F3F6]" aria-hidden>
                <div className="h-full rounded-full" style={{ width: `${(i.micro / max) * 100}%`, minWidth: i.micro > 0 ? 4 : 0, background: i.cor }} />
              </div>
              <p className="text-[12px] leading-[16px] text-[#58585E]">{i.detalhe}</p>
            </li>
          ))}
        </ul>
      </div>
    </PainelHp>
  )
}

export function GastoHistorico({ uso, ia, cotacao }: { uso: UsoApis | null | undefined; ia: UsoIa | null | undefined; cotacao: number }) {
  const dias = (uso?.ultimos7 ?? []).map((d) => d.dia)
  if (!dias.length && !ia?.ultimos7.length) return null
  const eixo = dias.length ? dias : ia!.ultimos7.map((d) => d.dia)
  const google = eixo.map((d) => { const u = uso?.ultimos7.find((x) => x.dia === d); return u ? ((custoGoogleMicroUsd(u) / 1e6) * cotacao) : 0 })
  const claude = eixo.map((d) => ((ia?.ultimos7.find((x) => x.dia === d)?.custoMicroUsd ?? 0) / 1e6) * cotacao)
  return (
    <PainelHp className="p-[16px] sm:p-[24px]" testid="sa-gasto-historico">
      <h2 className="mb-[4px] text-[16px] font-semibold leading-[24px] text-[#18181A]">Gasto por dia</h2>
      <GraficoDiasHp rotulo="Gasto em reais nos últimos 7 dias" dias={eixo} altura={190}
        formato={(v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 0.1 ? 4 : 2 })}
        series={[{ nome: 'Google Maps', cor: '#0B86C9', valores: google }, { nome: 'IA (Claude)', cor: '#673DE6', valores: claude }]} />
    </PainelHp>
  )
}
