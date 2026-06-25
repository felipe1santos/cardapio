'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Lock, Bike, MapPin, Check, PackageCheck } from 'lucide-react'
import { enderecoCompletoPedido, type CaixaEntregador, type FormaPagamento, type Pedido } from '@/lib/queries/pedidos'
import { RouteMap } from '@/components/maps/route-map'

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`
const PAY_LABEL: Record<FormaPagamento, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

interface PortalData {
  entregador: { nome: string; restauranteNome: string }
  pedidos: Pedido[]
  disponiveis: Pedido[]
  despachoAberto: boolean
  concluidosHoje: number
  caixaHoje: CaixaEntregador
}

const enderecoCompleto = enderecoCompletoPedido

function resumoItens(p: Pedido): string[] {
  return p.itens.map((i) => `${i.quantidade}x ${i.nome}`)
}

export default function EntregadorPortalPage() {
  const params = useParams()
  const token = params.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/entregador/${token}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Link inválido')
        return
      }
      setData(json)
      setError(null)
    } catch {
      setError('Não foi possível carregar suas entregas.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, 10000)
    return () => clearInterval(interval)
  }, [refetch])

  const atualizarLocalizacao = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeo(null),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  useEffect(() => {
    atualizarLocalizacao()
  }, [atualizarLocalizacao])

  // Registra o service worker para permitir instalar o app na tela inicial.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw-entregador.js', { scope: '/entregador/' }).catch(() => {})
    }
  }, [])

  // Heartbeat: avisa o painel que o motoboy está com o app aberto e onde ele está.
  useEffect(() => {
    const enviar = () => {
      fetch(`/api/entregador/${token}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geo ?? {}),
      }).catch(() => {})
    }
    enviar()
    const interval = setInterval(enviar, 30000)
    return () => clearInterval(interval)
  }, [token, geo])

  const pedidos = data?.pedidos ?? []
  const disponiveis = data?.disponiveis ?? []
  const despachoAberto = data?.despachoAberto ?? false
  const routeStops = useMemo(
    () => pedidos.map((p, i) => ({ id: p.id, numero: i + 1, address: enderecoCompleto(p) })),
    [pedidos]
  )

  async function confirmarEntrega(pedidoId: string) {
    setBusy(pedidoId)
    setActionError(null)
    try {
      const res = await fetch(`/api/entregador/${token}/pedidos/${pedidoId}/entregar`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível confirmar')
      await refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível confirmar a entrega')
    } finally {
      setBusy(null)
    }
  }

  async function reportarProblema(pedidoId: string) {
    if (!confirm(`Marcar o pedido #${pedidos.find((p) => p.id === pedidoId)?.numero} como não entregue?`)) return
    setBusy(pedidoId)
    setActionError(null)
    try {
      const res = await fetch(`/api/entregador/${token}/pedidos/${pedidoId}/problema`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível atualizar')
      await refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível atualizar o pedido')
    } finally {
      setBusy(null)
    }
  }

  async function pegarPedido(pedidoId: string) {
    setBusy(pedidoId)
    setActionError(null)
    try {
      const res = await fetch(`/api/entregador/${token}/pedidos/${pedidoId}/pegar`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível pegar o pedido')
      await refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível pegar o pedido')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-page text-sm text-text-subtle">Carregando sua rota…</div>
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-6">
        <div className="w-full max-w-sm rounded-menuzia border border-border bg-white p-5 text-center">
          <h1 className="text-sm font-bold text-danger">Link inválido</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-subtle">{error ?? 'Não encontramos sua rota.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-page pb-10">
      {/* Header */}
      <header className="bg-sidebar-bg px-4 py-4 text-white">
        <div className="mx-auto max-w-[480px]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-text">{data.entregador.restauranteNome}</div>
          <h1 className="text-lg font-extrabold">Olá, {data.entregador.nome}</h1>
          <div className="mt-3 flex gap-2">
            <div className="flex-1 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Em rota</div>
              <div className="text-xl font-bold">{pedidos.length}</div>
            </div>
            <div className="flex-1 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Entregues hoje</div>
              <div className="text-xl font-bold">{data.concluidosHoje}</div>
            </div>
          </div>

          {data.caixaHoje.recebido > 0 && (
            <div className="mt-2 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Caixa em dinheiro hoje</div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-sidebar-text">Recebido</div>
                  <div className="text-sm font-bold">{brl(data.caixaHoje.recebido)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-sidebar-text">Troco dado</div>
                  <div className="text-sm font-bold">{brl(data.caixaHoje.trocoDado)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-sidebar-text">Devolver</div>
                  <div className="text-sm font-bold text-status-ready">{brl(data.caixaHoje.aDevolver)}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[480px] px-4 pt-4">
        {actionError && (
          <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{actionError}</div>
        )}

        {/* Mapa da rota */}
        {routeStops.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              Sua rota — paradas na ordem da lista abaixo
            </div>
            <RouteMap apiKey={MAPS_KEY} origin={geo} stops={routeStops} className="h-[220px] w-full" />
            {!geo && (
              <button
                onClick={atualizarLocalizacao}
                className="flex w-full items-center justify-center gap-1.5 border-t border-border bg-white py-2 text-xs font-semibold text-primary hover:bg-page"
              >
                Ativar localização para ver a rota a partir de você
              </button>
            )}
          </div>
        )}

        {/* Minhas entregas (em rota) — trava sequencial: só a 1ª da fila é liberada */}
        {pedidos.length > 0 && (
          <div className="flex flex-col gap-3">
            {pedidos.map((order, index) => {
              const liberado = index === 0
              return (
              <div
                key={order.id}
                className={`overflow-hidden rounded-menuzia border bg-white ${liberado ? 'border-status-ready' : 'border-border'}`}
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="text-sm font-bold">Pedido #{order.numero}</span>
                  </div>
                  <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                </div>

                <div className={`px-4 py-3 ${liberado ? '' : 'opacity-60'}`}>
                  <div className="text-sm font-semibold">{order.clienteNome || 'Cliente'}</div>
                  {order.clienteTelefone && (
                    <a href={`tel:${order.clienteTelefone}`} className="mt-0.5 inline-block text-[13px] font-medium text-primary">
                      {order.clienteTelefone}
                    </a>
                  )}

                  <div className="mt-2 flex items-start gap-1 text-[13px] leading-relaxed text-text-main">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-subtle" />
                    {enderecoCompleto(order)}
                  </div>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(enderecoCompleto(order))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
                  >
                    Abrir no Google Maps →
                  </a>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-alert-text">
                      {PAY_LABEL[order.formaPagamento]}
                    </span>
                    {order.formaPagamento === 'dinheiro' && (
                      <span className="rounded-menuzia bg-warn-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">
                        {order.trocoPara !== null ? `Levar troco p/ ${brl(order.trocoPara)}` : 'Sem troco'}
                      </span>
                    )}
                    {!order.pago && (
                      <span className="rounded-menuzia bg-danger-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-danger">
                        Receber {brl(order.total)}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 rounded-menuzia border border-border bg-page px-3 py-2 text-[12px] text-text-subtle">
                    {resumoItens(order).join(' · ')}
                  </div>
                </div>

                {liberado ? (
                  <div className="flex gap-2 border-t border-border p-3">
                    <button
                      onClick={() => reportarProblema(order.id)}
                      disabled={busy === order.id}
                      className="rounded-menuzia border border-danger px-3 py-3 text-xs font-bold uppercase tracking-wide text-danger hover:bg-danger-bg disabled:opacity-50"
                    >
                      Não entreguei
                    </button>
                    <button
                      onClick={() => confirmarEntrega(order.id)}
                      disabled={busy === order.id}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-menuzia bg-status-ready py-3 text-sm font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" /> {busy === order.id ? 'Confirmando…' : 'Entregue'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-1.5 border-t border-border bg-page p-3 text-[12px] font-semibold text-text-subtle">
                    <Lock className="h-3.5 w-3.5" /> Finalize o pedido #{pedidos[index - 1].numero} para liberar
                  </div>
                )}
              </div>
              )
            })}
          </div>
        )}

        {/* Balcão: pedidos prontos liberados pela loja para o motoboy pegar */}
        {despachoAberto && disponiveis.length > 0 && (
          <div className={pedidos.length > 0 ? 'mt-5' : ''}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
              <PackageCheck className="h-4 w-4 text-status-pending" />
              Disponíveis para pegar
              <span className="rounded-full bg-page px-1.5 text-text-subtle">{disponiveis.length}</span>
            </div>
            {pedidos.length > 0 && (
              <div className="mb-2 flex items-center gap-1.5 rounded-menuzia border border-warn/40 bg-warn-bg px-3 py-2 text-[12px] font-medium text-warn">
                <Lock className="h-3.5 w-3.5 flex-shrink-0" /> Conclua sua entrega atual para pegar um novo pedido.
              </div>
            )}
            <div className="flex flex-col gap-3">
              {disponiveis.map((order) => (
                <div key={order.id} className="overflow-hidden rounded-menuzia border border-border bg-white">
                  <div className="flex items-center justify-between border-b border-border bg-status-pending/5 px-4 py-3">
                    <span className="text-sm font-bold">Pedido #{order.numero}</span>
                    <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-sm font-semibold">{order.clienteNome || 'Cliente'}</div>
                    <div className="mt-1 flex items-start gap-1 text-[13px] leading-relaxed text-text-main">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-subtle" />
                      {enderecoCompleto(order)}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-alert-text">
                        {PAY_LABEL[order.formaPagamento]}
                      </span>
                      {order.formaPagamento === 'dinheiro' && (
                        <span className="rounded-menuzia bg-warn-bg px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">
                          {order.trocoPara !== null ? `Troco p/ ${brl(order.trocoPara)}` : 'Sem troco'}
                        </span>
                      )}
                    </div>
                    <div className="mt-3 rounded-menuzia border border-border bg-page px-3 py-2 text-[12px] text-text-subtle">
                      {resumoItens(order).join(' · ')}
                    </div>
                  </div>
                  <div className="border-t border-border p-3">
                    <button
                      onClick={() => pegarPedido(order.id)}
                      disabled={busy === order.id || pedidos.length > 0}
                      className="flex w-full items-center justify-center gap-1.5 rounded-menuzia bg-status-pending py-3 text-sm font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-40"
                    >
                      <Bike className="h-4 w-4" /> {busy === order.id ? 'Pegando…' : 'Pegar entrega'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Vazio total: sem entrega em rota e sem balcão disponível */}
        {pedidos.length === 0 && disponiveis.length === 0 && (
          <div className="rounded-menuzia border border-dashed border-border bg-white p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-page">
              <Bike className="h-6 w-6 text-text-subtle" />
            </div>
            <p className="font-semibold text-text-main">Nenhuma entrega na sua rota agora</p>
            <p className="mt-1 text-[13px] text-text-subtle">
              {despachoAberto
                ? 'Assim que a loja liberar um pedido pronto, ele aparece aqui para você pegar.'
                : 'Quando um pedido for atribuído a você, ele aparece aqui.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
