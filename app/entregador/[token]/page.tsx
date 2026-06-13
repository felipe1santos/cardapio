'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import type { FormaPagamento, Pedido } from '@/lib/queries/pedidos'

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`
const PAY_LABEL: Record<FormaPagamento, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

interface PortalData {
  entregador: { nome: string; restauranteNome: string }
  pedidos: Pedido[]
  concluidosHoje: number
}

function enderecoCompleto(p: Pedido) {
  const linha1 = [p.enderecoRua, p.enderecoNumero].filter(Boolean).join(', ')
  const linha2 = [p.enderecoComplemento, p.enderecoBairro].filter(Boolean).join(' - ')
  return [linha1, linha2, p.enderecoCep].filter(Boolean).join(', ')
}

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

  const pedidos = data?.pedidos ?? []
  const addresses = useMemo(() => pedidos.map(enderecoCompleto), [pedidos])

  const mapsSrc = useMemo(() => {
    if (!MAPS_KEY || addresses.length === 0) return null
    if (!geo) return `https://www.google.com/maps/embed/api/1?key=${MAPS_KEY}&q=${encodeURIComponent(addresses[0])}`
    const destination = addresses[addresses.length - 1]
    const waypoints = addresses.slice(0, -1)
    const sp = new URLSearchParams({ key: MAPS_KEY, origin: `${geo.lat},${geo.lng}`, destination, mode: 'driving' })
    if (waypoints.length) sp.set('waypoints', waypoints.join('|'))
    return `https://www.google.com/maps/embed/api/1?${sp.toString()}`
  }, [addresses, geo])

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
        </div>
      </header>

      <div className="mx-auto max-w-[480px] px-4 pt-4">
        {actionError && (
          <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{actionError}</div>
        )}

        {/* Mapa da rota */}
        {mapsSrc && (
          <div className="mb-4 overflow-hidden rounded-menuzia border border-border bg-white">
            <iframe
              title="Rota das entregas"
              src={mapsSrc}
              className="h-[200px] w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
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

        {/* Lista de entregas */}
        {pedidos.length === 0 ? (
          <div className="rounded-menuzia border border-dashed border-border bg-white p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-page text-2xl">🛵</div>
            <p className="font-semibold text-text-main">Nenhuma entrega na sua rota agora</p>
            <p className="mt-1 text-[13px] text-text-subtle">Quando um pedido for atribuído a você, ele aparece aqui.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pedidos.map((order) => (
              <div key={order.id} className="overflow-hidden rounded-menuzia border border-border bg-white">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-sm font-bold">Pedido #{order.numero}</span>
                  <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                </div>

                <div className="px-4 py-3">
                  <div className="text-sm font-semibold">{order.clienteNome || 'Cliente'}</div>
                  {order.clienteTelefone && (
                    <a href={`tel:${order.clienteTelefone}`} className="mt-0.5 inline-block text-[13px] font-medium text-primary">
                      {order.clienteTelefone}
                    </a>
                  )}

                  <div className="mt-2 text-[13px] leading-relaxed text-text-main">{enderecoCompleto(order)}</div>
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
                    className="flex-1 rounded-menuzia bg-status-ready py-3 text-sm font-extrabold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-50"
                  >
                    {busy === order.id ? 'Confirmando…' : '✓ Entregue'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
