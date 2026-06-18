'use client'

import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { carregarDashboard, type DadosDashboard } from '@/lib/queries/pedidos'

type Period = 'hoje' | 'semana' | 'mes' | 'ano' | 'tudo'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mês' },
  { id: 'ano', label: 'Ano' },
  { id: 'tudo', label: 'Tudo' },
]

const PAY_LABEL: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }
const PAY_COLOR: Record<string, string> = { pix: '#0688D4', cartao: '#3B82F6', dinheiro: '#F97316' }

const brl = (value: number) => `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function periodStart(period: Period, now: number): number {
  const d = new Date(now)
  if (period === 'hoje') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (period === 'semana') return now - 7 * 86400000
  if (period === 'mes') return now - 30 * 86400000
  if (period === 'ano') return now - 365 * 86400000
  return 0
}

function smoothLine(values: number[], width: number, height: number, padding: number) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((v, i) => ({
    x: padding + (i * (width - padding * 2)) / (values.length - 1 || 1),
    y: height - padding - ((v - min) / span) * (height - padding * 2),
  }))

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
  }

  const area = `${path} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
  return { line: path, area }
}

function DonutChart({ slices }: { slices: { color: string; pct: number; name: string }[] }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const visible = slices.filter((s) => s.pct > 0)

  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#F3F4F6" strokeWidth="18" />
      {visible.map((slice) => {
        const dash = (slice.pct / 100) * circumference
        const circle = (
          <circle
            key={slice.name}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={slice.color}
            strokeWidth="18"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        )
        offset += dash
        return circle
      })}
    </svg>
  )
}

export default function DashboardPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [period, setPeriod] = useState<Period>('hoje')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dados, setDados] = useState<DadosDashboard>({ pedidos: [], grupoPorItem: {} })

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active) return
      if (!id) {
        setError('Não encontramos uma loja vinculada ao seu usuário.')
        setLoading(false)
        return
      }
      try {
        setDados(await carregarDashboard(supabase, id))
      } catch {
        setError('Não foi possível carregar o dashboard.')
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase])

  const m = useMemo(() => {
    const now = Date.now()
    const start = periodStart(period, now)
    const pedidos = dados.pedidos.filter((p) => new Date(p.criadoEm).getTime() >= start)

    const total = pedidos.reduce((s, p) => s + p.total, 0)
    const count = pedidos.length
    const ticket = count ? total / count : 0

    // série temporal (8 baldes entre o início efetivo e agora)
    const inicioEfetivo = period === 'tudo' && pedidos.length
      ? Math.min(...pedidos.map((p) => new Date(p.criadoEm).getTime()))
      : start
    const buckets = 8
    const span = Math.max(1, now - inicioEfetivo)
    const series = new Array(buckets).fill(0)
    for (const p of pedidos) {
      const idx = Math.min(buckets - 1, Math.floor(((new Date(p.criadoEm).getTime() - inicioEfetivo) / span) * buckets))
      series[Math.max(0, idx)] += p.total
    }
    if (series.every((v) => v === 0)) series[buckets - 1] = 0

    // pagamentos (share por receita)
    const payAgg: Record<string, number> = {}
    for (const p of pedidos) payAgg[p.formaPagamento] = (payAgg[p.formaPagamento] ?? 0) + p.total
    const payments = (['pix', 'cartao', 'dinheiro'] as const).map((k) => ({
      name: PAY_LABEL[k],
      color: PAY_COLOR[k],
      pct: total ? Math.round(((payAgg[k] ?? 0) / total) * 100) : 0,
    }))

    // canais
    const entrega = pedidos.filter((p) => p.tipo === 'entrega').length
    const channels = { delivery: count ? Math.round((entrega / count) * 100) : 0, pickup: count ? Math.round(((count - entrega) / count) * 100) : 0 }

    // top itens (por quantidade)
    const itemAgg: Record<string, number> = {}
    for (const p of pedidos) for (const i of p.itens) itemAgg[i.nome] = (itemAgg[i.nome] ?? 0) + i.quantidade
    const topSorted = Object.entries(itemAgg).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topMax = topSorted[0]?.[1] ?? 1
    const topItems = topSorted.map(([name, sold]) => ({ name, sold, pct: Math.round((sold / topMax) * 100) }))

    // categorias (por receita do grupo)
    const catAgg: Record<string, number> = {}
    for (const p of pedidos)
      for (const i of p.itens) {
        const grupo = i.itemId ? dados.grupoPorItem[i.itemId] ?? 'Sem grupo' : 'Sem grupo'
        catAgg[grupo] = (catAgg[grupo] ?? 0) + i.receita
      }
    const categories = Object.entries(catAgg).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6)

    // horário de pico
    const horas = new Array(24).fill(0)
    for (const p of pedidos) horas[new Date(p.criadoEm).getHours()]++
    const peak = horas.reduce((best, c, h) => (c > horas[best] ? h : best), 0)
    const peakHour = count ? `${peak}h – ${(peak + 1) % 24}h` : '—'

    // taxa de conclusão
    const entregues = pedidos.filter((p) => p.status === 'entregue').length
    const completionRate = count ? `${Math.round((entregues / count) * 100)}%` : '—'

    return { total, count, ticket, series, payments, channels, topItems, categories, peakHour, completionRate }
  }, [dados, period])

  const { line, area } = useMemo(() => smoothLine(m.series, 600, 160, 16), [m.series])
  const maxCategory = Math.max(1, ...m.categories.map((c) => c.value))

  if (loading) {
    return (
      <>
        <TopBar title="Dashboard" breadcrumb="Visão geral › Desempenho" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando dashboard…</div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Dashboard" breadcrumb="Visão geral › Desempenho" />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        {error && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}

        <div className="inline-flex w-fit overflow-hidden rounded-menuzia border border-border bg-white">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={['px-4 py-2 text-[13px] font-semibold transition-colors', period === p.id ? 'bg-primary text-white' : 'text-text-subtle hover:bg-page'].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {m.count === 0 && (
          <div className="rounded-menuzia border border-dashed border-border bg-white p-8 text-center text-sm text-text-subtle">
            Nenhum pedido neste período ainda. Faça um pedido na vitrine para ver os números aparecerem aqui.
          </div>
        )}

        {/* Hero faturamento */}
        <div className="rounded-menuzia bg-gradient-to-br from-primary to-primary-dark p-6 text-white">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/80">Faturamento · {PERIODS.find((p) => p.id === period)?.label}</div>
          <div className="mb-4 text-3xl font-bold">{brl(m.total)}</div>
          <svg viewBox="0 0 600 160" className="h-32 w-full">
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="white" stopOpacity="0.35" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#areaFill)" />
            <path d={line} fill="none" stroke="white" strokeWidth="2.5" />
          </svg>
        </div>

        {/* Mini grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Faturamento total</div>
            <div className="mt-1.5 text-xl font-bold text-price-text">{brl(m.total)}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pedidos</div>
            <div className="mt-1.5 text-xl font-bold">{m.count.toLocaleString('pt-BR')}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ticket médio</div>
            <div className="mt-1.5 text-xl font-bold">{brl(m.ticket)}</div>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold">Faturamento por categoria</h3>
            <div className="space-y-3">
              {m.categories.length === 0 && <div className="py-6 text-center text-xs text-text-subtle">Sem dados ainda.</div>}
              {m.categories.map((cat) => (
                <div key={cat.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-text-main">{cat.name}</span>
                    <span className="text-text-subtle">{brl(cat.value)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-page">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(cat.value / maxCategory) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-menuzia border border-border bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold">Formas de pagamento</h3>
            <div className="flex items-center gap-6">
              <DonutChart slices={m.payments} />
              <div className="space-y-2">
                {m.payments.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
                    <span className="font-medium text-text-main">{p.name}</span>
                    <span className="text-text-subtle">{p.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold">Top 5 itens vendidos</h3>
            <div className="space-y-3">
              {m.topItems.length === 0 && <div className="py-6 text-center text-xs text-text-subtle">Sem vendas ainda.</div>}
              {m.topItems.map((item, index) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-text-main">
                      <span className="mr-1.5 inline-block w-4 text-text-subtle">{index + 1}º</span>
                      {item.name}
                    </span>
                    <span className="text-text-subtle">{item.sold} vendidos</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-page">
                    <div className="h-full rounded-full bg-purple" style={{ width: `${item.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-menuzia border border-border bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold">Vendas por canal</h3>
              <div className="mb-2 flex h-3 overflow-hidden rounded-full bg-page">
                <div className="h-full bg-primary" style={{ width: `${m.channels.delivery}%` }} />
                <div className="h-full bg-status-pending" style={{ width: `${m.channels.pickup}%` }} />
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-text-main">🛵 Entrega · {m.channels.delivery}%</span>
                <span className="font-medium text-text-main">🏪 Retirada · {m.channels.pickup}%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-menuzia border border-border bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Horário de pico</div>
                <div className="mt-1.5 text-base font-bold">{m.peakHour}</div>
              </div>
              <div className="rounded-menuzia border border-border bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Taxa de conclusão</div>
                <div className="mt-1.5 text-base font-bold text-price-text">{m.completionRate}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
