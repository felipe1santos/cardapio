'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatarCentavos } from '@/lib/financeiro/centavos'
import { ATALHOS, periodoDoAtalho, type Atalho } from '@/lib/financeiro/fluxo-regras'
import type { Dre } from '@/lib/financeiro/contas-regras'
import { Chip } from '../ui/blocos'

/**
 * DRE simplificado (Fase 5b): faturamento do livro-caixa − CMV guardado na venda − despesas por categoria
 * = lucro líquido, com o período anterior de mesmo tamanho ao lado.
 */
interface Resposta {
  periodo: { de: string; ate: string }; anterior: { de: string; ate: string; dre: Dre }; atual: Dre
  variacao: Record<'faturamento' | 'cmv' | 'lucroBruto' | 'despesas' | 'lucroLiquido' | 'outrasReceitas', number | null>
  cmv: { semCustoRegistrado: number; comErro: number; linhas: number }
}
const brl = (c: number) => formatarCentavos(c)
const pct = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`)
const dataBR = (d: string) => d.split('-').reverse().join('/')

export function SecaoDre() {
  const [atalho, setAtalho] = useState<Atalho>('mes')
  const [r, setR] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const p = periodoDoAtalho(atalho)
    const res = await fetch(`/api/admin/financeiro/contas/dre?de=${p.de}&ate=${p.ate}`, { cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setErro(j.error ?? 'Não foi possível calcular.'); return }
    setErro(null); setR(j)
  }, [atalho])
  useEffect(() => { void carregar() }, [carregar])

  const fat = r?.atual.faturamentoCentavos ?? 0
  const deFat = (v: number) => (fat > 0 ? `${((v / fat) * 100).toFixed(1).replace('.', ',')}%` : '')
  type L = { rotulo: string; atual: number; anterior: number | null; variacao?: number | null; forte?: boolean; sinal?: '-' | '+' | '='; testid?: string }
  const linhas: L[] = !r ? [] : [
    { rotulo: 'Faturamento', atual: r.atual.faturamentoCentavos, anterior: r.anterior.dre.faturamentoCentavos, variacao: r.variacao.faturamento, forte: true, testid: 'dre-faturamento' },
    { rotulo: 'CMV (custo do que foi vendido)', atual: r.atual.cmvCentavos, anterior: r.anterior.dre.cmvCentavos, variacao: r.variacao.cmv, sinal: '-', testid: 'dre-cmv' },
    { rotulo: 'Lucro bruto', atual: r.atual.lucroBrutoCentavos, anterior: r.anterior.dre.lucroBrutoCentavos, variacao: r.variacao.lucroBruto, forte: true, sinal: '=', testid: 'dre-lucro-bruto' },
    ...r.atual.outrasReceitas.map((x) => ({ rotulo: x.nome, atual: x.valorCentavos, anterior: r.anterior.dre.outrasReceitas.find((y) => y.nome === x.nome)?.valorCentavos ?? 0, sinal: '+' as const })),
    ...r.atual.despesas.map((x) => ({ rotulo: x.nome, atual: x.valorCentavos, anterior: r.anterior.dre.despesas.find((y) => y.nome === x.nome)?.valorCentavos ?? 0, sinal: '-' as const })),
    { rotulo: 'Total de despesas', atual: r.atual.despesasCentavos, anterior: r.anterior.dre.despesasCentavos, variacao: r.variacao.despesas, sinal: '-', testid: 'dre-despesas' },
    { rotulo: 'Lucro líquido', atual: r.atual.lucroLiquidoCentavos, anterior: r.anterior.dre.lucroLiquidoCentavos, variacao: r.variacao.lucroLiquido, forte: true, sinal: '=', testid: 'dre-lucro-liquido' },
  ]

  return (
    <div className="flex flex-col gap-3" data-testid="secao-dre">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
        {ATALHOS.map((a) => <Chip key={a.id} ativo={atalho === a.id} onClick={() => setAtalho(a.id)} testid={`dre-atalho-${a.id}`}>{a.rotulo}</Chip>)}
      </div>
      {erro && <p role="alert" className="rounded-[4px] bg-[#FEE2E2] px-3 py-2 text-[13px] text-[#B91C1C]">{erro}</p>}
      {r && (
        <>
          <p className="text-[12.5px] text-text-subtle">
            {dataBR(r.periodo.de)} a {dataBR(r.periodo.ate)} · comparado com {dataBR(r.anterior.de)} a {dataBR(r.anterior.ate)}
          </p>
          <div className="overflow-x-auto rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white">
            <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[13px]" data-testid="dre-tabela">
              <thead className="bg-[#F6F7F9] text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                <tr className="[&>th]:border-b [&>th]:border-border"><th className="px-3 py-2.5" /><th className="px-3 py-2.5 text-right">Período</th><th className="px-3 py-2.5 text-right">% do fat.</th><th className="px-3 py-2.5 text-right">Anterior</th><th className="px-3 py-2.5 text-right">Variação</th></tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i} className={`[&>td]:border-b [&>td]:border-border ${l.forte ? 'bg-[#F9FAFB] font-bold' : ''}`} data-testid={l.testid}>
                    <td className={`px-3 py-2 ${l.forte ? '' : 'pl-6 text-text-subtle'}`}>{l.sinal === '-' ? '(−) ' : l.sinal === '+' ? '(+) ' : l.sinal === '=' ? '(=) ' : ''}{l.rotulo}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right ${l.testid === 'dre-lucro-liquido' ? (l.atual < 0 ? 'text-[#B91C1C]' : 'text-[#15803D]') : ''}`} data-valor={l.atual}>{brl(l.atual)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-text-subtle">{deFat(l.atual)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-text-subtle">{l.anterior === null ? '—' : brl(l.anterior)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-text-subtle">{l.variacao === undefined ? '' : pct(l.variacao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-1 text-[12.5px] text-text-subtle" data-testid="dre-notas">
            {r.cmv.semCustoRegistrado > 0 && <p>⚠ {r.cmv.semCustoRegistrado} item(ns) vendido(s) sem custo registrado (sem ficha ou de antes da Fase 5): o CMV está abaixo do real.</p>}
            <p>Fora do resultado: compras de insumos no período {brl(r.atual.comprasInsumosCentavos)} (o custo delas entra no CMV quando o produto é vendido){r.atual.foraDoResultadoCentavos ? ` · aportes ${brl(r.atual.foraDoResultadoCentavos)}` : ''}.</p>
            <p>Faturamento = o que entrou no livro-caixa pelas vendas (data do recebimento). Despesas = contas pagas e saídas do caixa no período (regime de caixa).</p>
          </div>
        </>
      )}
    </div>
  )
}
