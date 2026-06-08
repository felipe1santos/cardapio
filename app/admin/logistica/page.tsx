'use client'

import { useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type DriverStatus = 'online' | 'busy' | 'offline'

interface Driver {
  id: string
  name: string
  status: DriverStatus
  active: number
}

interface ReadyOrder {
  id: string
  customer: string
  area: string
  pay: string
  needsChange: boolean
  changeFor?: string
  total: string
  driverId: string | null
}

interface CashClosing {
  driver: string
  expected: string
  declared: string
  diff: string
  ok: boolean
}

const DRIVERS: Driver[] = [
  { id: 'd1', name: 'Lucas Andrade', status: 'online', active: 1 },
  { id: 'd2', name: 'Patrícia Gomes', status: 'online', active: 0 },
  { id: 'd3', name: 'Diego Martins', status: 'busy', active: 2 },
  { id: 'd4', name: 'Wellington Costa', status: 'offline', active: 0 },
]

const STATUS_LABEL: Record<DriverStatus, string> = {
  online: 'Disponível',
  busy: 'Ocupado',
  offline: 'Offline',
}

const STATUS_DOT: Record<DriverStatus, string> = {
  online: 'bg-status-ready',
  busy: 'bg-status-pending',
  offline: 'bg-text-subtle',
}

const INITIAL_READY: ReadyOrder[] = [
  { id: '#1033', customer: 'Felipe Tavares', area: 'Jardim da Penha · 2,8 km', pay: 'Dinheiro', needsChange: true, changeFor: 'R$ 60,00', total: 'R$ 50,90', driverId: null },
  { id: '#1031', customer: 'Carla Mendes', area: 'Praia do Suá · 3,5 km', pay: 'Pix', needsChange: false, total: 'R$ 41,30', driverId: 'd1' },
  { id: '#1029', customer: 'Henrique Dias', area: 'Bento Ferreira · 4,1 km', pay: 'Cartão na entrega', needsChange: false, total: 'R$ 67,00', driverId: 'd3' },
  { id: '#1027', customer: 'Sofia Almeida', area: 'Mata da Praia · 2,2 km', pay: 'Dinheiro', needsChange: true, changeFor: 'R$ 100,00', total: 'R$ 38,50', driverId: 'd3' },
]

const CLOSINGS: CashClosing[] = [
  { driver: 'Diego Martins', expected: 'R$ 106,50', declared: 'R$ 106,50', diff: 'R$ 0,00', ok: true },
  { driver: 'Lucas Andrade', expected: 'R$ 50,90', declared: 'R$ 45,90', diff: '− R$ 5,00', ok: false },
]

function driverName(id: string | null) {
  if (!id) return null
  return DRIVERS.find((d) => d.id === id)?.name ?? null
}

export default function LogisticaPage() {
  const [orders, setOrders] = useState<ReadyOrder[]>(INITIAL_READY)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [closingOpen, setClosingOpen] = useState(false)

  const available = DRIVERS.filter((d) => d.status === 'online')
  const unassigned = orders.filter((o) => !o.driverId)
  const inRoute = orders.filter((o) => o.driverId)

  function assign(orderId: string, driverId: string) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, driverId } : o)))
    setAssigning(null)
  }

  return (
    <>
      <TopBar title="Logística" breadcrumb="Logística › Despacho de entregas" />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Entregadores online</div>
            <div className="mt-1.5 text-2xl font-bold">{available.length}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Aguardando despacho</div>
            <div className="mt-1.5 text-2xl font-bold text-status-pending">{unassigned.length}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Em rota</div>
            <div className="mt-1.5 text-2xl font-bold text-status-preparing">{inRoute.length}</div>
          </div>
          <div className="rounded-menuzia border border-border bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pendências de caixa</div>
            <div className="mt-1.5 text-2xl font-bold text-danger">{CLOSINGS.filter((c) => !c.ok).length}</div>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
          {/* Drivers */}
          <aside className="flex flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Entregadores</h3>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {DRIVERS.map((driver) => (
                <div key={driver.id} className="rounded-menuzia border border-border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold">{driver.name}</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[driver.status]}`} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-subtle">
                    <span>{STATUS_LABEL[driver.status]}</span>
                    <span>{driver.active} entrega(s) em rota</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-3">
              <Button variant="outline" className="w-full" onClick={() => setClosingOpen(true)}>
                Fechamento de caixa
              </Button>
            </div>
          </aside>

          {/* Orders to dispatch + in route */}
          <section className="flex flex-col gap-4 overflow-y-auto">
            <div className="rounded-menuzia border border-border bg-white">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Prontos para despachar</h3>
                <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{unassigned.length}</span>
              </div>
              <div className="divide-y divide-border">
                {unassigned.length === 0 && (
                  <div className="p-6 text-center text-sm text-text-subtle">Nenhum pedido aguardando despacho</div>
                )}
                {unassigned.map((order) => (
                  <div key={order.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm font-bold">{order.id}</span>
                        <span className="text-sm font-medium">{order.customer}</span>
                      </div>
                      <div className="mb-1.5 text-xs text-text-subtle">{order.area}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={order.pay === 'Dinheiro' ? 'pending' : 'alert'}>{order.pay}</Badge>
                        {order.needsChange && (
                          <Badge tone="paused">Troco para {order.changeFor}</Badge>
                        )}
                        <span className="text-sm font-bold text-price-text">{order.total}</span>
                      </div>
                    </div>
                    <div className="relative">
                      <Button variant="dispatch" onClick={() => setAssigning(assigning === order.id ? null : order.id)}>
                        Atribuir entregador
                      </Button>
                      {assigning === order.id && (
                        <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[200px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
                          {available.length === 0 && (
                            <div className="px-3 py-2 text-xs text-text-subtle">Nenhum entregador disponível</div>
                          )}
                          {available.map((driver) => (
                            <button
                              key={driver.id}
                              onClick={() => assign(order.id, driver.id)}
                              className="flex w-full items-center justify-between rounded-menuzia px-3 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page"
                            >
                              <span>{driver.name}</span>
                              <span className="text-xs text-text-subtle">{driver.active} em rota</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-menuzia border border-border bg-white">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Em rota</h3>
                <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{inRoute.length}</span>
              </div>
              <div className="divide-y divide-border">
                {inRoute.map((order) => (
                  <div key={order.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-sm font-bold">{order.id}</span>
                        <span className="text-sm font-medium">{order.customer}</span>
                        <Badge tone="preparing">Saiu para entrega</Badge>
                      </div>
                      <div className="mb-1.5 text-xs text-text-subtle">{order.area} · entregador: <b className="text-text-main">{driverName(order.driverId)}</b></div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={order.pay === 'Dinheiro' ? 'pending' : 'alert'}>{order.pay}</Badge>
                        {order.needsChange && <Badge tone="paused">Troco para {order.changeFor}</Badge>}
                        <span className="text-sm font-bold text-price-text">{order.total}</span>
                      </div>
                    </div>
                    <Button variant="success">Marcar como entregue</Button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Cash closing drawer */}
      {closingOpen && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setClosingOpen(false)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[440px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          closingOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Fechamento de caixa</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Conferência entre valor esperado e valor declarado por entregador.</p>
          </div>
          <button onClick={() => setClosingOpen(false)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <p className="mb-4 text-xs leading-relaxed text-text-subtle">
            Some o dinheiro recebido em pedidos pagos em espécie e o troco que o entregador levou consigo. Compare com o
            valor declarado ao final da rota para identificar diferenças.
          </p>
          {CLOSINGS.map((closing) => (
            <div key={closing.driver} className="mb-3 rounded-menuzia border border-border p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{closing.driver}</h4>
                <Badge tone={closing.ok ? 'ok' : 'danger'}>{closing.ok ? 'Confere' : 'Divergência'}</Badge>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-text-subtle">Valor esperado</span><span className="font-medium">{closing.expected}</span></div>
                <div className="flex justify-between"><span className="text-text-subtle">Valor declarado</span><span className="font-medium">{closing.declared}</span></div>
                <div className="flex justify-between border-t border-border pt-1.5 font-bold">
                  <span>Diferença</span>
                  <span className={closing.ok ? 'text-price-text' : 'text-danger'}>{closing.diff}</span>
                </div>
              </div>
            </div>
          ))}
          <div className="rounded-menuzia border border-dashed border-border p-3.5 text-center text-xs text-text-subtle">
            Novo fechamento é gerado automaticamente ao final de cada rota do entregador.
          </div>
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={() => setClosingOpen(false)}>
            Fechar
          </Button>
        </div>
      </aside>
    </>
  )
}
