'use client'

import { useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'

type Period = 'hoje' | 'semana' | 'mes' | 'ano' | 'tudo'

interface PeriodData {
  label: string
  revenueSeries: number[]
  revenueTotal: string
  ordersTotal: number
  ticketAvg: string
  kpis: { label: string; value: string }[]
  categories: { name: string; value: number }[]
  payments: { name: string; pct: number; color: string }[]
  topItems: { name: string; sold: number; pct: number }[]
  channels: { delivery: number; pickup: number }
  peakHour: string
  completionRate: string
}

const DATA: Record<Period, PeriodData> = {
  hoje: {
    label: 'Hoje',
    revenueSeries: [120, 180, 140, 260, 220, 340, 300, 420, 380, 460],
    revenueTotal: 'R$ 2.340,00',
    ordersTotal: 48,
    ticketAvg: 'R$ 48,75',
    kpis: [
      { label: 'Diário', value: 'R$ 2.340,00' },
      { label: 'Semanal', value: 'R$ 14.980,00' },
      { label: 'Mensal', value: 'R$ 61.250,00' },
      { label: 'Total', value: 'R$ 312.400,00' },
    ],
    categories: [
      { name: 'Lanches', value: 980 },
      { name: 'Combos', value: 620 },
      { name: 'Bebidas', value: 340 },
      { name: 'Sobremesas', value: 220 },
      { name: 'Porções', value: 180 },
    ],
    payments: [
      { name: 'Pix', pct: 48, color: '#06B6D4' },
      { name: 'Cartão', pct: 34, color: '#3B82F6' },
      { name: 'Dinheiro', pct: 18, color: '#F97316' },
    ],
    topItems: [
      { name: 'Burger Duplo Artesanal', sold: 32, pct: 100 },
      { name: 'X-Salada Clássico', sold: 27, pct: 84 },
      { name: 'Combo Família', sold: 19, pct: 59 },
      { name: 'Batata Frita G', sold: 16, pct: 50 },
      { name: 'Coca-Cola lata', sold: 14, pct: 44 },
    ],
    channels: { delivery: 68, pickup: 32 },
    peakHour: '19h – 21h',
    completionRate: '96%',
  },
  semana: {
    label: 'Semana',
    revenueSeries: [1400, 1800, 1600, 2100, 1950, 2600, 2340],
    revenueTotal: 'R$ 14.980,00',
    ordersTotal: 312,
    ticketAvg: 'R$ 48,01',
    kpis: [
      { label: 'Diário (méd.)', value: 'R$ 2.140,00' },
      { label: 'Semanal', value: 'R$ 14.980,00' },
      { label: 'Mensal', value: 'R$ 61.250,00' },
      { label: 'Total', value: 'R$ 312.400,00' },
    ],
    categories: [
      { name: 'Lanches', value: 6200 },
      { name: 'Combos', value: 3900 },
      { name: 'Bebidas', value: 2100 },
      { name: 'Sobremesas', value: 1500 },
      { name: 'Porções', value: 1280 },
    ],
    payments: [
      { name: 'Pix', pct: 51, color: '#06B6D4' },
      { name: 'Cartão', pct: 31, color: '#3B82F6' },
      { name: 'Dinheiro', pct: 18, color: '#F97316' },
    ],
    topItems: [
      { name: 'Burger Duplo Artesanal', sold: 201, pct: 100 },
      { name: 'X-Salada Clássico', sold: 168, pct: 84 },
      { name: 'Combo Família', sold: 122, pct: 61 },
      { name: 'Frango Crispy', sold: 98, pct: 49 },
      { name: 'Batata Frita G', sold: 87, pct: 43 },
    ],
    channels: { delivery: 71, pickup: 29 },
    peakHour: 'Sex e Sáb · 19h–22h',
    completionRate: '94%',
  },
  mes: {
    label: 'Mês',
    revenueSeries: [9800, 11200, 10400, 13600, 12100, 14980, 13200, 15600],
    revenueTotal: 'R$ 61.250,00',
    ordersTotal: 1284,
    ticketAvg: 'R$ 47,70',
    kpis: [
      { label: 'Diário (méd.)', value: 'R$ 1.975,00' },
      { label: 'Semanal (méd.)', value: 'R$ 13.820,00' },
      { label: 'Mensal', value: 'R$ 61.250,00' },
      { label: 'Total', value: 'R$ 312.400,00' },
    ],
    categories: [
      { name: 'Lanches', value: 26800 },
      { name: 'Combos', value: 16500 },
      { name: 'Bebidas', value: 9100 },
      { name: 'Sobremesas', value: 5400 },
      { name: 'Porções', value: 4900 },
    ],
    payments: [
      { name: 'Pix', pct: 49, color: '#06B6D4' },
      { name: 'Cartão', pct: 33, color: '#3B82F6' },
      { name: 'Dinheiro', pct: 18, color: '#F97316' },
    ],
    topItems: [
      { name: 'Burger Duplo Artesanal', sold: 812, pct: 100 },
      { name: 'X-Salada Clássico', sold: 690, pct: 85 },
      { name: 'Combo Família', sold: 498, pct: 61 },
      { name: 'Frango Crispy', sold: 401, pct: 49 },
      { name: 'Milkshake', sold: 356, pct: 44 },
    ],
    channels: { delivery: 70, pickup: 30 },
    peakHour: 'Sex–Dom · 19h–22h',
    completionRate: '95%',
  },
  ano: {
    label: 'Ano',
    revenueSeries: [42000, 48000, 51000, 55000, 58000, 61250, 64000, 67000, 63000, 70000, 72500, 75000],
    revenueTotal: 'R$ 312.400,00',
    ordersTotal: 14920,
    ticketAvg: 'R$ 46,90',
    kpis: [
      { label: 'Mensal (méd.)', value: 'R$ 56.300,00' },
      { label: 'Trimestral (méd.)', value: 'R$ 168.900,00' },
      { label: 'Anual', value: 'R$ 312.400,00' },
      { label: 'Total acumulado', value: 'R$ 980.100,00' },
    ],
    categories: [
      { name: 'Lanches', value: 142000 },
      { name: 'Combos', value: 89000 },
      { name: 'Bebidas', value: 47000 },
      { name: 'Sobremesas', value: 28000 },
      { name: 'Porções', value: 24000 },
    ],
    payments: [
      { name: 'Pix', pct: 47, color: '#06B6D4' },
      { name: 'Cartão', pct: 35, color: '#3B82F6' },
      { name: 'Dinheiro', pct: 18, color: '#F97316' },
    ],
    topItems: [
      { name: 'Burger Duplo Artesanal', sold: 9240, pct: 100 },
      { name: 'X-Salada Clássico', sold: 7820, pct: 85 },
      { name: 'Combo Família', sold: 5640, pct: 61 },
      { name: 'Frango Crispy', sold: 4510, pct: 49 },
      { name: 'Milkshake', sold: 3980, pct: 43 },
    ],
    channels: { delivery: 69, pickup: 31 },
    peakHour: 'Sex–Dom · 19h–22h',
    completionRate: '95%',
  },
  tudo: {
    label: 'Tudo',
    revenueSeries: [180000, 210000, 245000, 280000, 312400, 340000],
    revenueTotal: 'R$ 980.100,00',
    ordersTotal: 48230,
    ticketAvg: 'R$ 45,30',
    kpis: [
      { label: 'Mensal (méd.)', value: 'R$ 54.450,00' },
      { label: 'Anual (méd.)', value: 'R$ 326.700,00' },
      { label: 'Maior mês', value: 'R$ 75.000,00' },
      { label: 'Total acumulado', value: 'R$ 980.100,00' },
    ],
    categories: [
      { name: 'Lanches', value: 412000 },
      { name: 'Combos', value: 268000 },
      { name: 'Bebidas', value: 142000 },
      { name: 'Sobremesas', value: 89000 },
      { name: 'Porções', value: 69000 },
    ],
    payments: [
      { name: 'Pix', pct: 45, color: '#06B6D4' },
      { name: 'Cartão', pct: 36, color: '#3B82F6' },
      { name: 'Dinheiro', pct: 19, color: '#F97316' },
    ],
    topItems: [
      { name: 'Burger Duplo Artesanal', sold: 28400, pct: 100 },
      { name: 'X-Salada Clássico', sold: 24100, pct: 85 },
      { name: 'Combo Família', sold: 17200, pct: 61 },
      { name: 'Frango Crispy', sold: 13900, pct: 49 },
      { name: 'Milkshake', sold: 12100, pct: 43 },
    ],
    channels: { delivery: 67, pickup: 33 },
    peakHour: 'Sex–Dom · 19h–22h',
    completionRate: '94%',
  },
}

const PERIODS: { id: Period; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mês' },
  { id: 'ano', label: 'Ano' },
  { id: 'tudo', label: 'Tudo' },
]

function smoothLine(values: number[], width: number, height: number, padding: number) {
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const points = values.map((v, i) => ({
    x: padding + (i * (width - padding * 2)) / (values.length - 1),
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

function DonutChart({ slices }: { slices: { name: string; pct: number; color: string }[] }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#F3F4F6" strokeWidth="18" />
      {slices.map((slice) => {
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
  const [period, setPeriod] = useState<Period>('hoje')
  const data = DATA[period]

  const { line, area } = useMemo(() => smoothLine(data.revenueSeries, 600, 160, 16), [data])
  const maxCategory = Math.max(...data.categories.map((c) => c.value))

  return (
    <>
      <TopBar title="Dashboard" breadcrumb="Visão geral › Desempenho" />

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
        {/* Period filter */}
        <div className="inline-flex w-fit overflow-hidden rounded-menuzia border border-border bg-white">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={[
                'px-4 py-2 text-[13px] font-semibold transition-colors',
                period === p.id ? 'bg-primary text-white' : 'text-text-subtle hover:bg-page',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Hero revenue card */}
        <div className="rounded-menuzia bg-gradient-to-br from-primary to-primary-dark p-6 text-white">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/80">Faturamento · {data.label}</div>
          <div className="mb-4 text-3xl font-bold">{data.revenueTotal}</div>
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

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {data.kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-menuzia border border-border bg-white p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{kpi.label}</div>
              <div className="mt-1.5 text-xl font-bold">{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Mini grid: total / pedidos / ticket médio */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Faturamento total</div>
            <div className="mt-1.5 text-xl font-bold text-price-text">{data.revenueTotal}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pedidos</div>
            <div className="mt-1.5 text-xl font-bold">{data.ordersTotal.toLocaleString('pt-BR')}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ticket médio</div>
            <div className="mt-1.5 text-xl font-bold">{data.ticketAvg}</div>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Category bar chart */}
          <div className="rounded-menuzia border border-border bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold">Faturamento por categoria</h3>
            <div className="space-y-3">
              {data.categories.map((cat) => (
                <div key={cat.name}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-text-main">{cat.name}</span>
                    <span className="text-text-subtle">R$ {cat.value.toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-page">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(cat.value / maxCategory) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Payment donut */}
          <div className="rounded-menuzia border border-border bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold">Formas de pagamento</h3>
            <div className="flex items-center gap-6">
              <DonutChart slices={data.payments} />
              <div className="space-y-2">
                {data.payments.map((p) => (
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
          {/* Top sellers */}
          <div className="rounded-menuzia border border-border bg-white p-4">
            <h3 className="mb-4 text-sm font-semibold">Top 5 itens vendidos</h3>
            <div className="space-y-3">
              {data.topItems.map((item, index) => (
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

          {/* Channel split + peak hour + completion */}
          <div className="flex flex-col gap-4">
            <div className="rounded-menuzia border border-border bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold">Vendas por canal</h3>
              <div className="mb-2 flex h-3 overflow-hidden rounded-full bg-page">
                <div className="h-full bg-primary" style={{ width: `${data.channels.delivery}%` }} />
                <div className="h-full bg-status-pending" style={{ width: `${data.channels.pickup}%` }} />
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-text-main">🛵 Entrega · {data.channels.delivery}%</span>
                <span className="font-medium text-text-main">🏪 Retirada · {data.channels.pickup}%</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-menuzia border border-border bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Horário de pico</div>
                <div className="mt-1.5 text-base font-bold">{data.peakHour}</div>
              </div>
              <div className="rounded-menuzia border border-border bg-white p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Taxa de conclusão</div>
                <div className="mt-1.5 text-base font-bold text-price-text">{data.completionRate}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
