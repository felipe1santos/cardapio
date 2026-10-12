'use client'

/**
 * Super Admin › Gasto por loja (12/10/2026): hoje / 7 dias / mês de cada loja, por serviço (Agente de IA e Google Maps), em
 * US$ e R$ pela cotação editável; total do sistema no topo; teto diário da IA ao lado (editável). Ordem: quem mais gastou no
 * mês. Barras simples (sem biblioteca). Só leitura, fora o teto e a cotação.
 */
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { Fatia, GastoLojas } from '@/lib/custo/gasto-lojas'
import { COTA_GRATIS_GOOGLE_MES } from '@/lib/custo/gasto-lojas'
import { TetoIaLoja, usd } from '@/components/superadmin/uso-ia'
import { definirCotacaoAction } from '@/app/superadmin/actions'

type Periodo = 'hoje' | 'semana' | 'mes'
const ROTULO: Record<Periodo, string> = { hoje: 'Hoje', semana: 'Últimos 7 dias', mes: 'Mês atual' }
const reais = (micro: number, cot: number) => ((micro / 1e6) * cot).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: micro > 0 && micro < 2e5 ? 4 : 2 })
const num = (n: number) => n.toLocaleString('pt-BR')
const totalDe = (f: Fatia) => f.iaMicroUsd + f.googleMicroUsd
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function Cotacao({ atual }: { atual: number }) {
  const [valor, setValor] = useState(String(atual).replace('.', ','))
  const [msg, setMsg] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()
  return (
    <form
      className="flex items-center gap-2 text-[13px]"
      onSubmit={(e) => { e.preventDefault(); iniciar(async () => { const r = await definirCotacaoAction(valor); setMsg(r.ok ? 'Salvo' : r.erro) }) }}
      data-testid="gasto-cotacao"
    >
      <label htmlFor="cotacao" className="text-text-subtle">Cotação do dólar (R$)</label>
      <input id="cotacao" inputMode="decimal" value={valor} onChange={(e) => { setValor(e.target.value); setMsg(null) }} className="h-[32px] w-[72px] rounded-[3px] border border-border px-2 tabular-nums" />
      <button type="submit" disabled={pendente} className="h-[32px] rounded-[3px] border border-border px-2.5 text-[11px] font-semibold uppercase hover:border-primary disabled:opacity-50">Salvar</button>
      {msg && <span role="status" className={msg === 'Salvo' ? 'text-[#16A34A]' : 'text-[#B91C1C]'}>{msg}</span>}
    </form>
  )
}

function Valores({ f, cot }: { f: Fatia; cot: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12.5px] tabular-nums sm:grid-cols-4">
      <span><span className="text-text-subtle">IA </span>{usd(f.iaMicroUsd)} · {reais(f.iaMicroUsd, cot)}</span>
      <span><span className="text-text-subtle">Respostas </span>{num(f.iaChamadas)}</span>
      <span><span className="text-text-subtle">Google </span>{usd(f.googleMicroUsd)} · {reais(f.googleMicroUsd, cot)}</span>
      <span className="text-text-subtle">{num(f.geocoding)} endereços · {num(f.directions)} rotas · {num(f.maps_js)} mapas</span>
    </div>
  )
}

export function GastoPorLoja({ gasto, nomes, cotacao, tetosLoja, tetoPadrao }: {
  gasto: GastoLojas; nomes: Record<string, string>; cotacao: number; tetosLoja: Record<string, number>; tetoPadrao: number
}) {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const max = Math.max(1, ...gasto.lojas.map((l) => totalDe(l[periodo])))
  const t = gasto.total[periodo]
  const googleMes = gasto.total.mes
  const dentroDaCota = googleMes.geocoding <= COTA_GRATIS_GOOGLE_MES && googleMes.directions <= COTA_GRATIS_GOOGLE_MES && googleMes.maps_js <= COTA_GRATIS_GOOGLE_MES
  return (
    <div className="min-h-dvh bg-page pb-16">
      <header className="sticky top-0 z-30 flex h-[56px] items-center gap-3 border-b border-border bg-white px-4 sm:px-6">
        <Link href="/superadmin" className="flex h-[36px] w-[36px] items-center justify-center rounded-[4px] border border-border hover:border-primary" aria-label="Voltar ao painel"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-text-main sm:text-[19px]">Gasto por loja</h1>
        <Cotacao atual={cotacao} />
      </header>

      <main className="mx-auto max-w-[1100px] space-y-4 px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Período">
          {(Object.keys(ROTULO) as Periodo[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={periodo === p} onClick={() => setPeriodo(p)}
              className={`h-[34px] rounded-[3px] border px-3 text-[12px] font-semibold uppercase ${periodo === p ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main hover:border-primary'}`}>
              {ROTULO[p]}
            </button>
          ))}
        </div>

        <section className="rounded-[3px] border border-border bg-white p-4" data-testid="gasto-total">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-text-main">Total do sistema — {ROTULO[periodo].toLowerCase()}</h2>
            <span className="text-[20px] font-semibold tabular-nums text-text-main">{usd(totalDe(t))} · {reais(totalDe(t), cotacao)}</span>
          </div>
          <div className="mt-2"><Valores f={t} cot={cotacao} /></div>
          <p className="mt-2 text-[12px] text-text-subtle">
            Google pelo preço de tabela (US$ 5 por mil endereços ou rotas, US$ 7 por mil mapas).{' '}
            {dentroDaCota ? 'Neste mês o sistema está dentro da cota grátis de 10 mil por serviço: o Google cobra R$ 0.' : 'Neste mês o sistema passou da cota grátis de 10 mil em algum serviço.'}
            {' '}Dados por loja só existem desde {dataBR(gasto.porLojaDesde)}; antes disso, sem dado por loja.
          </p>
        </section>

        <ul className="space-y-2" data-testid="gasto-lojas">
          {gasto.lojas.map((l) => {
            const f = l[periodo]
            const pct = (totalDe(f) / max) * 100
            return (
              <li key={l.loja} className="rounded-[3px] border border-border bg-white p-3" data-testid="gasto-loja">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-main">{nomes[l.loja] ?? l.loja.slice(0, 8)}</span>
                  <span className="text-[14px] font-semibold tabular-nums text-text-main">{usd(totalDe(f))} · {reais(totalDe(f), cotacao)}</span>
                  <TetoIaLoja restauranteId={l.loja} teto={tetosLoja[l.loja]} padrao={tetoPadrao} />
                </div>
                <div className="my-2 h-[8px] overflow-hidden rounded-full bg-[#EDEEF1]" aria-hidden>
                  <div className="flex h-full" style={{ width: `${pct}%` }}>
                    <span className="h-full bg-[#A855F7]" style={{ width: `${totalDe(f) ? (f.iaMicroUsd / totalDe(f)) * 100 : 0}%` }} />
                    <span className="h-full bg-[#0688D4]" style={{ width: `${totalDe(f) ? (f.googleMicroUsd / totalDe(f)) * 100 : 0}%` }} />
                  </div>
                </div>
                <Valores f={f} cot={cotacao} />
              </li>
            )
          })}
        </ul>
        <p className="text-[12px] text-text-subtle"><span className="inline-block h-[8px] w-[8px] rounded-full bg-[#A855F7] align-middle" /> Agente de IA (Claude, custo real) · <span className="inline-block h-[8px] w-[8px] rounded-full bg-[#0688D4] align-middle" /> Google Maps (preço de tabela)</p>
      </main>
    </div>
  )
}
