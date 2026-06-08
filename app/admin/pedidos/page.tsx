'use client'

import { useEffect, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Stage = 'pending' | 'preparing' | 'ready'
type OrderType = 'delivery' | 'pickup'

interface Order {
  id: string
  stage: Stage
  type: OrderType
  customer: string
  area: string
  items: string[]
  pay: string
  paid: boolean
  total: string
  mins: number
  isNew?: boolean
}

const INITIAL_ORDERS: Order[] = [
  { id: '#1042', stage: 'pending', type: 'delivery', customer: 'Marina Souza', area: 'Jardim Camburi · 3,2 km', items: ['1x Burger Duplo Artesanal', '1x Batata Frita G', '+1 item'], pay: 'Pix', paid: true, total: 'R$ 58,80', mins: 2, isNew: true },
  { id: '#1041', stage: 'pending', type: 'pickup', customer: 'Carlos Eduardo', area: 'Retirada no balcão', items: ['2x X-Salada Clássico', '1x Coca-Cola lata'], pay: 'Cartão', paid: false, total: 'R$ 55,80', mins: 6 },
  { id: '#1039', stage: 'preparing', type: 'delivery', customer: 'Renata Lima', area: 'Praia do Canto · 5,1 km', items: ['1x Combo Família'], pay: 'Dinheiro', paid: false, total: 'R$ 89,90', mins: 14 },
  { id: '#1038', stage: 'preparing', type: 'delivery', customer: 'João Pedro', area: 'Mata da Praia · 4,0 km', items: ['1x Frango Crispy', '1x Onion Rings', '+2 itens'], pay: 'Pix', paid: true, total: 'R$ 72,40', mins: 21 },
  { id: '#1035', stage: 'ready', type: 'pickup', customer: 'Beatriz Alves', area: 'Retirada no balcão', items: ['1x Veggie Burger', '1x Suco natural'], pay: 'Pix', paid: true, total: 'R$ 35,50', mins: 9 },
  { id: '#1033', stage: 'ready', type: 'delivery', customer: 'Felipe Tavares', area: 'Jardim da Penha · 2,8 km', items: ['1x Burger Duplo Artesanal', '1x Milkshake'], pay: 'Dinheiro', paid: false, total: 'R$ 50,90', mins: 24 },
]

const STAGE_LABELS: Record<Stage, string> = {
  pending: 'Pedido Recebido',
  preparing: 'Preparando',
  ready: 'Pronto p/ Despacho',
}

const STAGE_BORDER: Record<Stage, string> = {
  pending: 'border-t-status-pending',
  preparing: 'border-t-status-preparing',
  ready: 'border-t-status-ready',
}

const TIMELINE_STEPS = ['Recebido', 'Preparando', 'Pronto', 'Em rota', 'Entregue']

function timerTone(mins: number) {
  if (mins < 10) return 'bg-price-bg text-price-text'
  if (mins < 20) return 'bg-warn-bg text-warn'
  return 'bg-danger-bg text-danger'
}

function timelineIndex(stage: Stage, type: OrderType) {
  if (stage === 'pending') return 0
  if (stage === 'preparing') return 1
  return type === 'pickup' ? 2 : 2
}

export default function PedidosPage() {
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS)
  const [detail, setDetail] = useState<Order | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [arrived, setArrived] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => {
      setOrders((prev) => [
        {
          id: '#1043',
          stage: 'pending',
          type: 'delivery',
          customer: 'Ana Paula Reis',
          area: 'Bento Ferreira · 3,8 km',
          items: ['1x X-Bacon Supremo', '1x Batata Frita G', '1x Coca-Cola lata'],
          pay: 'Cartão',
          paid: false,
          total: 'R$ 53,80',
          mins: 0,
          isNew: true,
        },
        ...prev,
      ])
      setArrived(true)
      setTimeout(() => setArrived(false), 4000)
    }, 5000)
    return () => clearTimeout(timeout)
  }, [])

  function advance(order: Order) {
    setOrders((prev) => {
      if (order.stage === 'pending') {
        return prev.map((o) => (o.id === order.id ? { ...o, stage: 'preparing', isNew: false } : o))
      }
      if (order.stage === 'preparing') {
        return prev.map((o) => (o.id === order.id ? { ...o, stage: 'ready' } : o))
      }
      // ready -> delivered/dispatched: leaves the board
      return prev.filter((o) => o.id !== order.id)
    })
  }

  function moveToStage(id: string, stage: Stage) {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, stage, isNew: false } : o)))
  }

  const open = orders.length
  const inDelivery = orders.filter((o) => o.stage === 'ready' && o.type === 'delivery').length
  const revenue = orders.reduce((sum, o) => sum + parseFloat(o.total.replace('R$ ', '').replace('.', '').replace(',', '.')), 0)

  return (
    <>
      <TopBar title="Painel de Pedidos" breadcrumb="Pedidos › Kanban" />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        {/* Live indicator + sound toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 rounded-full bg-price-bg px-3 py-1.5 text-xs font-semibold text-price-text">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-price-text opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-price-text" />
            </span>
            Recebendo pedidos
          </div>
          <Button variant="outline">🔊 Som</Button>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pedidos abertos</div>
            <div className="mt-1.5 text-2xl font-bold">{open}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Tempo médio</div>
            <div className="mt-1.5 text-2xl font-bold">14 min</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Em entrega</div>
            <div className="mt-1.5 text-2xl font-bold">{inDelivery}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Faturamento do turno</div>
            <div className="mt-1.5 text-2xl font-bold text-price-text">
              R$ {revenue.toFixed(2).replace('.', ',')}
            </div>
          </div>
        </div>

        {/* Board */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-3">
          {(['pending', 'preparing', 'ready'] as Stage[]).map((stage) => {
            const stageOrders = orders.filter((o) => o.stage === stage)
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) moveToStage(dragId, stage)
                  setDragId(null)
                }}
                className={`flex flex-col overflow-hidden rounded-menuzia border border-border border-t-[3px] bg-white ${STAGE_BORDER[stage]}`}
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h3>
                  <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{stageOrders.length}</span>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  {stageOrders.map((order) => (
                    <div
                      key={order.id}
                      draggable
                      onDragStart={() => setDragId(order.id)}
                      className={[
                        'cursor-grab rounded-menuzia border border-border bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md',
                        order.isNew ? 'ring-2 ring-primary/40' : '',
                      ].join(' ')}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-bold">{order.id}</span>
                        <Badge tone={order.type === 'delivery' ? 'alert' : 'paused'}>
                          {order.type === 'delivery' ? 'Entrega' : 'Retirada'}
                        </Badge>
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <span className={`rounded-menuzia px-2 py-0.5 text-[11px] font-bold ${timerTone(order.mins)}`}>{order.mins} min</span>
                        <span className="text-[13px] font-semibold">{order.customer}</span>
                      </div>
                      <div className="mb-2 text-xs text-text-subtle">{order.area}</div>
                      <ul className="mb-3 space-y-0.5 text-xs text-text-subtle">
                        {order.items.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <div className="mb-3 flex items-center justify-between">
                        <Badge tone={order.paid ? 'ok' : 'pending'}>{order.paid ? 'Pago' : 'A receber'} · {order.pay}</Badge>
                        <span className="text-sm font-bold text-price-text">{order.total}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" className="flex-1" onClick={() => setDetail(order)}>
                          Detalhes
                        </Button>
                        {order.stage === 'pending' && (
                          <Button variant="primary" className="flex-1" onClick={() => advance(order)}>
                            Aceitar
                          </Button>
                        )}
                        {order.stage === 'preparing' && (
                          <Button variant="success" className="flex-1" onClick={() => advance(order)}>
                            Pronto
                          </Button>
                        )}
                        {order.stage === 'ready' && order.type === 'pickup' && (
                          <Button variant="success" className="flex-1" onClick={() => advance(order)}>
                            Entregue
                          </Button>
                        )}
                        {order.stage === 'ready' && order.type === 'delivery' && (
                          <Button variant="dispatch" className="flex-1" onClick={() => advance(order)}>
                            Despachar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {stageOrders.length === 0 && (
                    <div className="flex h-full items-center justify-center text-xs text-text-subtle">Nenhum pedido nesta etapa</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Toast: new order arrived */}
      {arrived && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-menuzia bg-sidebar-bg px-4 py-3 text-sm font-semibold text-white shadow-2xl">
          <span className="h-2 w-2 rounded-full bg-status-ready" />
          Novo pedido recebido — #1043
        </div>
      )}

      {/* Overlay + drawer */}
      {detail && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setDetail(null)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[440px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          detail ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {detail && (
          <>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-bold">Pedido {detail.id}</h2>
                <p className="mt-0.5 text-xs text-text-subtle">{detail.customer} · {detail.type === 'delivery' ? 'Entrega' : 'Retirada'}</p>
              </div>
              <button onClick={() => setDetail(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5">
              {/* Timeline */}
              <div className="mb-5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Linha do tempo</div>
              <div className="mb-6 space-y-0">
                {TIMELINE_STEPS.map((step, index) => {
                  const active = timelineIndex(detail.stage, detail.type)
                  const done = index < active || (index === active && detail.stage === 'ready')
                  const current = index === active && detail.stage !== 'ready'
                  return (
                    <div key={step} className="relative flex gap-3 pb-5 last:pb-0">
                      {index < TIMELINE_STEPS.length - 1 && (
                        <span className={`absolute left-[11px] top-6 h-full w-0.5 ${done ? 'bg-status-ready' : 'bg-border'}`} />
                      )}
                      <span
                        className={[
                          'z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2',
                          done ? 'border-status-ready bg-status-ready text-white' : current ? 'border-primary bg-primary' : 'border-border bg-white',
                        ].join(' ')}
                      >
                        {done && (
                          <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                        )}
                      </span>
                      <span className={`text-sm font-medium ${done || current ? 'text-text-main' : 'text-text-subtle'}`}>{step}</span>
                    </div>
                  )
                })}
              </div>

              {/* Items */}
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Itens do pedido</div>
              <ul className="mb-5 space-y-1.5 rounded-menuzia border border-border p-3 text-sm">
                {detail.items.map((line) => (
                  <li key={line} className="flex justify-between text-text-main">
                    <span>{line}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-border pt-2 font-bold">
                  <span>Total</span>
                  <span className="text-price-text">{detail.total}</span>
                </li>
              </ul>

              {/* Customer & payment */}
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cliente & pagamento</div>
              <div className="mb-5 space-y-1.5 rounded-menuzia border border-border p-3 text-sm">
                <div className="flex justify-between"><span className="text-text-subtle">Cliente</span><span className="font-medium">{detail.customer}</span></div>
                <div className="flex justify-between"><span className="text-text-subtle">Pagamento</span><span className="font-medium">{detail.pay}</span></div>
                <div className="flex justify-between">
                  <span className="text-text-subtle">Status</span>
                  <Badge tone={detail.paid ? 'ok' : 'pending'}>{detail.paid ? 'Pago' : 'A receber'}</Badge>
                </div>
              </div>

              {/* Delivery info */}
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Entrega</div>
              <div className="rounded-menuzia border border-border p-3 text-sm">
                <div className="mb-2 text-text-main">{detail.area}</div>
                <div className="flex h-28 items-center justify-center rounded-menuzia bg-page text-xs text-text-subtle">Mapa indisponível (mock)</div>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
