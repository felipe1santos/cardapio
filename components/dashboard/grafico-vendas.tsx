'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { marcasX, marcasY } from '@/components/graficos/grafico'
import { Abas } from '@/components/graficos/kit-meta'
import { escolherAgrupamento, montarBaldes, resumir, type Balde, type PedidoGrafico } from '@/lib/dashboard-grafico'
import type { Intervalo } from '@/lib/dashboard-metricas'

/**
 * Gráfico de Faturamento / Pedidos / Ticket médio do Dashboard (09/10). Mesma lista de pedidos do "Resumo do
 * período" (os totais batem centavo por centavo); agrupamento automático no fuso de Brasília (lib/dashboard-grafico).
 * Lucro e margem só para dono e gerente (custo gravado na venda: ficha técnica ou preço de custo do cardápio).
 */
type Aba = 'faturamento' | 'pedidos' | 'ticket'
const COR = { azul: '#1877F2', area: '#E7F0FD', verde: '#0A8F4E', cinza: '#9AA4AE', texto: '#1C2B33', eixo: '#465A69', grade: '#EEEEEE', hover: '#BABDC2', pdv: '#32CDCD', mesa: '#F5A623', media: '#007A80' }
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const brlEixo = (c: number) => { const r = c / 100; return r >= 1000 ? `R$ ${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(r)}` }
const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export function GraficoVendas({ pedidos, anteriores, intervalo, intervaloAnterior, custos, podeLucro, carregando, erro }: {
  pedidos: (PedidoGrafico & { id: string })[]; anteriores: (PedidoGrafico & { id: string })[]
  intervalo: Intervalo; intervaloAnterior: Intervalo | null
  /** null = ainda carregando ou sem permissão; Map vazio = nenhuma venda com custo. */
  custos: Map<string, number> | null; podeLucro: boolean; carregando: boolean; erro: string | null
}) {
  const [aba, setAba] = useState<Aba>('faturamento')
  const [ocultas, setOcultas] = useState<Set<string>>(new Set())
  const g = escolherAgrupamento(intervalo)
  const baldes = useMemo(() => montarBaldes(pedidos, intervalo, g, custos), [pedidos, intervalo, g, custos])
  const ant = useMemo(() => (intervaloAnterior ? montarBaldes(anteriores, intervaloAnterior, g, custos) : []), [anteriores, intervaloAnterior, g, custos])
  const r = resumir(baldes), ra = resumir(ant)
  const temCusto = podeLucro && custos !== null && r.faturamentoComCusto > 0
  const semNenhumCusto = podeLucro && custos !== null && r.faturamento > 0 && r.faturamentoComCusto === 0

  const total = aba === 'faturamento' ? r.faturamento : aba === 'pedidos' ? r.pedidos : r.ticket ?? 0
  const totalAnt = aba === 'faturamento' ? ra.faturamento : aba === 'pedidos' ? ra.pedidos : ra.ticket ?? 0
  const variacao = intervaloAnterior && totalAnt > 0 ? ((total - totalAnt) / totalAnt) * 100 : null
  const fmtTotal = aba === 'pedidos' ? total.toLocaleString('pt-BR') : brl(total)
  const alternar = (k: string) => setOcultas((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <section className="fin-meta rounded-[8px] border border-[#E4E7EA] bg-white" data-testid="grafico-vendas">
      <div className="px-3 pt-3 [&_[role=tab]]:flex-1 sm:[&_[role=tab]]:flex-none">
        <Abas<Aba> itens={[['faturamento', 'Faturamento'], ['pedidos', 'Pedidos'], ['ticket', 'Ticket médio']]} ativo={aba} onSelecionar={setAba} testidPrefixo="grafico-aba" />
      </div>
      <div className="px-4 pb-4 pt-3 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[24px] font-semibold leading-tight text-[#1C2B33]" data-testid="grafico-total" data-valor={total}>{carregando ? '—' : fmtTotal}</span>
          {variacao !== null && !carregando && (
            <span className={`text-[13px] font-semibold ${variacao >= 0 ? 'text-[#0A8F4E]' : 'text-[#D93616]'}`} data-testid="grafico-variacao">
              {variacao >= 0 ? '▲' : '▼'} {pct(Math.abs(variacao))} <span className="font-normal text-[#465A69]">vs. período anterior</span>
            </span>
          )}
          {aba === 'faturamento' && temCusto && r.margemPct !== null && (
            <span className="text-[13px] text-[#1C2B33]" data-testid="grafico-lucro">Lucro <b className="font-semibold text-[#0A8F4E]">{brl(r.lucro)}</b> (margem {pct(r.margemPct)})</span>
          )}
        </div>
        {aba === 'faturamento' && temCusto && r.coberturaPct !== null && r.coberturaPct < 99.95 && (
          <p className="mt-1 text-[12.5px] text-[#465A69]" data-testid="grafico-cobertura">Lucro calculado sobre {pct(r.coberturaPct)} das vendas (itens sem custo ficam de fora).</p>
        )}
        {aba === 'faturamento' && semNenhumCusto && (
          <p className="mt-1 text-[12.5px] text-[#465A69]" data-testid="grafico-sem-custo">
            <Link href="/admin/cardapio" className="font-semibold text-[#1877F2] hover:underline">Cadastre o preço de custo dos itens para ver o lucro</Link>
          </p>
        )}
        <div className="mt-3">
          {erro ? <p className="py-16 text-center text-[13px] text-[#D93616]" data-testid="grafico-erro">{erro}</p>
            : carregando ? <div className="h-[220px] animate-pulse rounded-[8px] bg-[#F1F3F5] sm:h-[280px]" data-testid="grafico-carregando" />
            : r.pedidos === 0 ? <p className="py-16 text-center text-[13px] text-[#465A69]" data-testid="grafico-vazio">Sem vendas no período.</p>
            : <Desenho aba={aba} baldes={baldes} ant={ant} temLucro={temCusto} ocultas={ocultas} alternar={alternar} />}
        </div>
      </div>
    </section>
  )
}

type Serie = { chave: string; nome: string; valores: number[]; cor: string; tipo: 'area' | 'linha' | 'barra'; traco?: string; formatar: (n: number) => string }

function Desenho({ aba, baldes, ant, temLucro, ocultas, alternar }: { aba: Aba; baldes: Balde[]; ant: Balde[]; temLucro: boolean; ocultas: Set<string>; alternar: (k: string) => void }) {
  const caixa = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(640)
  const [foco, setFoco] = useState<number | null>(null)
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const n = baldes.length
  const anterior = (f: (b: Balde) => number) => baldes.map((_, i) => (ant[i] ? f(ant[i]) : 0))
  const ticket = (b: Balde) => (b.pedidos ? b.faturamento / b.pedidos : 0)
  const series: Serie[] = aba === 'faturamento' ? [
    { chave: 'fat', nome: 'Faturamento', valores: baldes.map((b) => b.faturamento), cor: COR.azul, tipo: 'area', formatar: brl },
    ...(temLucro ? [{ chave: 'lucro', nome: 'Lucro bruto', valores: baldes.map((b) => b.lucro), cor: COR.verde, tipo: 'linha' as const, formatar: brl }] : []),
    ...(ant.length ? [{ chave: 'ant', nome: 'Período anterior', valores: anterior((b) => b.faturamento), cor: COR.cinza, tipo: 'linha' as const, traco: '2 4', formatar: brl }] : []),
  ] : aba === 'pedidos' ? [
    { chave: 'vitrine', nome: 'Vitrine', valores: baldes.map((b) => b.porCanal.vitrine), cor: COR.azul, tipo: 'barra', formatar: (v) => v.toLocaleString('pt-BR') },
    { chave: 'pdv', nome: 'PDV/Balcão', valores: baldes.map((b) => b.porCanal.pdv), cor: COR.pdv, tipo: 'barra', formatar: (v) => v.toLocaleString('pt-BR') },
    { chave: 'mesa', nome: 'Mesa', valores: baldes.map((b) => b.porCanal.mesa), cor: COR.mesa, tipo: 'barra', formatar: (v) => v.toLocaleString('pt-BR') },
  ] : [
    { chave: 'ticket', nome: 'Ticket médio', valores: baldes.map(ticket), cor: COR.azul, tipo: 'linha', formatar: brl },
    ...(ant.length ? [{ chave: 'ant', nome: 'Período anterior', valores: anterior(ticket), cor: COR.cinza, tipo: 'linha' as const, traco: '2 4', formatar: brl }] : []),
  ]
  const visiveis = series.filter((s) => !ocultas.has(s.chave))
  const somaPedidos = baldes.reduce((s, b) => s + b.faturamento, 0)
  const qtd = baldes.reduce((s, b) => s + b.pedidos, 0)
  const media = aba === 'ticket' && qtd ? somaPedidos / qtd : null
  const empilhado = aba === 'pedidos'
  const maxVal = empilhado
    ? Math.max(1, ...baldes.map((_, i) => visiveis.reduce((s, x) => s + x.valores[i], 0)))
    : Math.max(1, ...visiveis.flatMap((s) => s.valores), media ?? 0)
  const minVal = Math.min(0, ...visiveis.flatMap((s) => s.valores))
  const ticks = marcasY(maxVal, minVal)
  const yMin = ticks[0], yMax = ticks[ticks.length - 1]
  const altura = largura < 500 ? 220 : 280
  const esq = aba === 'pedidos' ? 34 : 64, dir = 10, topo = 10, baixo = 26
  const w = largura - esq - dir, h = altura - topo - baixo
  const x = (i: number) => (empilhado ? esq + ((i + 0.5) * w) / Math.max(1, n) : esq + (n <= 1 ? w / 2 : (i * w) / (n - 1)))
  const y = (v: number) => topo + h - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * h
  const passo = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 64))))
  const marcas = marcasX(n, passo, x)
  const fmtEixo = aba === 'pedidos' ? (v: number) => String(Math.round(v)) : brlEixo
  const caminho = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const larguraBarra = Math.max(3, Math.min(28, (w / Math.max(1, n)) * 0.62))

  const indiceDe = (clientX: number) => {
    const r = caixa.current?.getBoundingClientRect()
    if (!r || !n) return null
    const px = clientX - r.left
    const i = empilhado ? Math.floor(((px - esq) / w) * n) : Math.round(((px - esq) / Math.max(1, w)) * (n - 1))
    return Math.max(0, Math.min(n - 1, i))
  }
  const b = foco !== null ? baldes[foco] : null
  const lucroPct = b && b.faturamentoComCusto > 0 ? (b.lucro / b.faturamentoComCusto) * 100 : null

  return (
    <div>
      <div ref={caixa} className="relative touch-pan-y select-none" data-testid="grafico-desenho"
        onPointerMove={(e) => setFoco(indiceDe(e.clientX))} onPointerDown={(e) => setFoco(indiceDe(e.clientX))} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setFoco(null) }}>
        <svg width={largura} height={altura} role="img" aria-label={`Gráfico de ${aba}`} className="block max-w-full">
          {ticks.map((t) => <g key={t}><line x1={esq} x2={largura - dir} y1={y(t)} y2={y(t)} stroke={COR.grade} /><text x={esq - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill={COR.eixo}>{fmtEixo(t)}</text></g>)}
          {marcas.map((i) => <text key={i} x={x(i)} y={altura - 8} textAnchor="middle" fontSize="11" fill={COR.eixo}>{baldes[i].rotulo}</text>)}
          {foco !== null && !empilhado && <line x1={x(foco)} x2={x(foco)} y1={topo} y2={topo + h} stroke={COR.hover} />}
          {foco !== null && empilhado && <rect x={x(foco) - w / n / 2} y={topo} width={w / n} height={h} fill="#F2F2F2" />}
          {empilhado && baldes.map((_, i) => {
            let base = 0
            return <g key={i}>{visiveis.map((s) => { const v = s.valores[i]; const y0 = y(base), y1 = y(base + v); base += v; return v ? <rect key={s.chave} x={x(i) - larguraBarra / 2} y={y1} width={larguraBarra} height={Math.max(0, y0 - y1)} fill={s.cor} /> : null })}</g>
          })}
          {!empilhado && visiveis.filter((s) => s.tipo === 'area').map((s) => (
            <g key={s.chave}>
              <path d={`${caminho(s.valores)} L${x(n - 1)},${y(Math.max(0, yMin))} L${x(0)},${y(Math.max(0, yMin))} Z`} fill={COR.area} />
              <path d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth="2" />
            </g>
          ))}
          {media !== null && <line x1={esq} x2={largura - dir} y1={y(media)} y2={y(media)} stroke={COR.media} strokeDasharray="6 4" data-testid="grafico-media" />}
          {!empilhado && visiveis.filter((s) => s.tipo === 'linha').map((s) => <path key={s.chave} d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth="2" strokeDasharray={s.traco} />)}
          {foco !== null && !empilhado && visiveis.map((s) => <circle key={s.chave} cx={x(foco)} cy={y(s.valores[foco])} r="4" fill="#fff" stroke={s.cor} strokeWidth="2" />)}
        </svg>
        {b && foco !== null && (
          <div className="pointer-events-none absolute top-1 z-10 min-w-[180px] rounded-[8px] border border-[#CBD2D9] bg-white p-2.5 text-[12.5px] shadow-[0_4px_14px_rgba(28,43,51,0.18)]"
            style={{ left: Math.min(Math.max(0, x(foco) + 12), largura - 200) }} data-testid="grafico-tooltip">
            <p className="mb-1 font-semibold text-[#1C2B33]">{b.periodo}</p>
            {series.filter((s) => !ocultas.has(s.chave)).map((s) => (
              <p key={s.chave} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: s.cor }} />{s.nome}</span><b className="font-semibold">{s.formatar(s.valores[foco])}</b></p>
            ))}
            {aba === 'pedidos' && <p className="flex justify-between gap-3 border-t border-[#EEE] pt-1"><span>Total</span><b className="font-semibold">{b.pedidos}</b></p>}
            {aba !== 'pedidos' && temLucro && <p className="mt-1 border-t border-[#EEE] pt-1 text-[#465A69]">Lucro {brl(b.lucro)}{lucroPct !== null ? ` · margem ${pct(lucroPct)}` : ''}</p>}
            {media !== null && <p className="text-[#465A69]">Média do período {brl(media)}</p>}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-testid="grafico-legenda">
        {series.map((s) => (
          <button key={s.chave} type="button" onClick={() => alternar(s.chave)} aria-pressed={!ocultas.has(s.chave)}
            className={`inline-flex min-h-[32px] items-center gap-1.5 text-[12.5px] font-semibold ${ocultas.has(s.chave) ? 'text-[#9AA4AE] line-through' : 'text-[#1C2B33]'}`} data-testid={`grafico-legenda-${s.chave}`}>
            <i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: s.cor, opacity: ocultas.has(s.chave) ? 0.35 : 1 }} />{s.nome}
          </button>
        ))}
        {media !== null && <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1C2B33]"><i className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: COR.media }} />Média do período</span>}
      </div>
    </div>
  )
}
