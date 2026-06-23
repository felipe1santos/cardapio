'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RouteMap } from '@/components/maps/route-map'
import { notificarPedido } from '@/lib/notificar'
import {
  atribuirEntregadorEmLote,
  enderecoCompletoPedido,
  listarEntregadores,
  listarPedidosLogistica,
  type Entregador,
  type Pedido,
} from '@/lib/queries/pedidos'

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`
const PAY_LABEL: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }

function tempoDesde(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min === 1) return 'há 1 min'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `há ${h}h` : `há ${h}h${m}min`
}

function endereco(p: Pedido) {
  const partes = [p.enderecoRua && `${p.enderecoRua}, ${p.enderecoNumero}`, p.enderecoBairro].filter(Boolean)
  return partes.join(' · ') || 'Entrega'
}

/** Chave de ordenação por proximidade de endereço (mesma região agrupada). */
function chaveEndereco(p: Pedido) {
  return `${p.enderecoBairro}|${p.enderecoRua}|${p.enderecoNumero}`.toLowerCase()
}

interface RotaPanelProps {
  supabase: SupabaseClient
  restauranteId: string
  apiKey?: string
  onClose: () => void
}

export function RotaPanel({ supabase, restauranteId, apiKey, onClose }: RotaPanelProps) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [drivers, setDrivers] = useState<Entregador[]>([])
  const [ordem, setOrdem] = useState<string[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [motoboyId, setMotoboyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [despachando, setDespachando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragIndex = useRef<number | null>(null)

  const refetch = useCallback(async () => {
    try {
      const [logistica, entregadores] = await Promise.all([
        listarPedidosLogistica(supabase, restauranteId),
        listarEntregadores(supabase, restauranteId),
      ])
      const prontos = logistica.filter((o) => o.status === 'pronto' && !o.entregadorId)
      setPedidos(prontos)
      setDrivers(entregadores)
      // mantém a ordem manual existente; novos pedidos entram ordenados por endereço
      setOrdem((prev) => {
        const ids = new Set(prontos.map((p) => p.id))
        const mantidos = prev.filter((id) => ids.has(id))
        const novos = prontos
          .filter((p) => !prev.includes(p.id))
          .sort((a, b) => chaveEndereco(a).localeCompare(chaveEndereco(b)))
          .map((p) => p.id)
        return [...mantidos, ...novos]
      })
      setMarcados((prev) => {
        const ids = new Set(prontos.map((p) => p.id))
        return new Set([...prev].filter((id) => ids.has(id)))
      })
    } catch {
      setError('Não foi possível carregar os pedidos prontos.')
    }
  }, [supabase, restauranteId])

  useEffect(() => {
    refetch()
    const channel = supabase
      .channel(`rota-panel-${restauranteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` }, () => refetch())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entregadores', filter: `restaurante_id=eq.${restauranteId}` }, () => refetch())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, restauranteId, refetch])

  const porId = useMemo(() => new Map(pedidos.map((p) => [p.id, p])), [pedidos])
  const ordenados = useMemo(() => ordem.map((id) => porId.get(id)).filter((p): p is Pedido => Boolean(p)), [ordem, porId])
  const disponiveis = drivers.filter((d) => d.status === 'online')
  const motoboy = drivers.find((d) => d.id === motoboyId) ?? null

  // Stops do mapa: os marcados na ordem atual; se nada marcado, todos os prontos.
  const stopsBase = marcados.size > 0 ? ordenados.filter((p) => marcados.has(p.id)) : ordenados
  const stops = stopsBase.map((p, i) => ({ id: p.id, numero: i + 1, address: enderecoCompletoPedido(p) }))

  function toggleMarcado(id: string) {
    setMarcados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onDragStart(i: number) {
    dragIndex.current = i
  }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    const from = dragIndex.current
    if (from === null || from === i) return
    setOrdem((prev) => {
      const arr = [...prev]
      const [moved] = arr.splice(from, 1)
      arr.splice(i, 0, moved)
      return arr
    })
    dragIndex.current = i
  }
  function onDragEnd() {
    dragIndex.current = null
  }

  const marcadosNaOrdem = ordenados.filter((p) => marcados.has(p.id))

  async function despachar() {
    if (!motoboy || marcadosNaOrdem.length === 0) return
    setDespachando(true)
    const ids = marcadosNaOrdem.map((p) => p.id)
    try {
      await atribuirEntregadorEmLote(supabase, ids, motoboy.id)
      for (const id of ids) notificarPedido(id, 'em_rota')
      setConfirming(false)
      setMarcados(new Set())
      setMotoboyId(null)
      await refetch()
    } catch {
      setError('Não foi possível despachar os pedidos.')
    } finally {
      setDespachando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#111827]/55 p-3 sm:p-4">
      <div className="flex flex-1 flex-col overflow-hidden rounded-menuzia bg-white shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[15px] font-bold">Despacho de rotas</h2>
            <p className="mt-0.5 text-xs text-text-subtle">
              Marque os pedidos, ordene a rota e atribua a um entregador.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="border-b border-danger bg-danger-bg px-4 py-2 text-[13px] font-medium text-danger">{error}</div>
        )}

        {/* Corpo: pedidos | mapa | entregadores */}
        <div className="relative grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[320px_1fr_260px]">
          {/* Coluna esquerda: pedidos prontos (arrastáveis) */}
          <aside className="flex flex-col overflow-hidden border-r border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <h3 className="text-sm font-semibold">Pedidos prontos</h3>
              <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{ordenados.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {ordenados.length === 0 && (
                <div className="px-2 py-8 text-center text-xs text-text-subtle">Nenhum pedido pronto aguardando entrega.</div>
              )}
              {ordenados.map((p, i) => {
                const ativo = marcados.has(p.id)
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={() => onDragStart(i)}
                    onDragOver={(e) => onDragOver(e, i)}
                    onDragEnd={onDragEnd}
                    onClick={() => toggleMarcado(p.id)}
                    className={[
                      'cursor-pointer select-none rounded-menuzia border p-2.5 transition-colors',
                      ativo
                        ? 'border-yellow-400 bg-yellow-300 text-black'
                        : 'border-border bg-white hover:border-primary/40',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="text-text-subtle/70">⠿</span>
                        <span className="rounded-menuzia bg-text-main px-1.5 py-0.5 text-xs font-bold text-white">#{p.numero}</span>
                        <span className="truncate text-[13px] font-semibold">{p.clienteNome || 'Cliente'}</span>
                      </div>
                      <span className={`flex-shrink-0 text-[11px] font-semibold ${ativo ? 'text-black/70' : 'text-text-subtle'}`}>
                        {tempoDesde(p.criadoEm)}
                      </span>
                    </div>
                    <div className={`mt-1 truncate text-xs ${ativo ? 'text-black/80' : 'text-text-subtle'}`}>{endereco(p)}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge tone={p.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[p.formaPagamento]}</Badge>
                      {p.formaPagamento === 'dinheiro' && p.trocoPara !== null && (
                        <Badge tone="paused">Troco {brl(p.trocoPara)}</Badge>
                      )}
                      <span className={`ml-auto text-[13px] font-bold ${ativo ? 'text-black' : 'text-price-text'}`}>{brl(p.total)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Mapa */}
          <div className="relative min-h-[280px] bg-page">
            <RouteMap apiKey={apiKey} origin={null} stops={stops} className="h-full w-full" />

            {/* Botão despachar centralizado embaixo */}
            {marcadosNaOrdem.length > 0 && motoboy && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
                <Button
                  variant="dispatch"
                  className="pointer-events-auto !px-6 !py-3 !text-[13px] shadow-2xl"
                  onClick={() => setConfirming(true)}
                >
                  Despachar {marcadosNaOrdem.length} pedido{marcadosNaOrdem.length > 1 ? 's' : ''} → {motoboy.nome}
                </Button>
              </div>
            )}
          </div>

          {/* Coluna direita: entregadores */}
          <aside className="flex flex-col overflow-hidden border-l border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <h3 className="text-sm font-semibold">Entregadores</h3>
              <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{disponiveis.length} online</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {disponiveis.length === 0 && (
                <div className="px-2 py-8 text-center text-xs text-text-subtle">Nenhum entregador online no momento.</div>
              )}
              {disponiveis.map((d) => {
                const sel = d.id === motoboyId
                return (
                  <button
                    key={d.id}
                    onClick={() => setMotoboyId(sel ? null : d.id)}
                    className={[
                      'flex w-full items-center justify-between gap-2 rounded-menuzia border p-2.5 text-left transition-colors',
                      sel ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/40',
                    ].join(' ')}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold">{d.nome}</div>
                      <div className="text-[11px] text-text-subtle">{d.emRota} em rota</div>
                    </div>
                    <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${sel ? 'bg-primary' : 'bg-status-ready'}`} />
                  </button>
                )
              })}
            </div>
            <div className="border-t border-border p-2.5 text-center text-[11px] text-text-subtle">
              {marcadosNaOrdem.length === 0
                ? 'Marque ao menos um pedido'
                : !motoboy
                  ? 'Selecione um entregador'
                  : 'Pronto para despachar'}
            </div>
          </aside>
        </div>
      </div>

      {/* Modal de confirmação */}
      {confirming && motoboy && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[#111827]/60 p-4" onClick={() => !despachando && setConfirming(false)}>
          <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-bold">Confirmar despacho</h2>
                <p className="mt-0.5 text-xs text-text-subtle">
                  {marcadosNaOrdem.length} pedido{marcadosNaOrdem.length > 1 ? 's' : ''} para <b className="text-text-main">{motoboy.nome}</b>
                </p>
              </div>
              <button
                onClick={() => !despachando && setConfirming(false)}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5">
              <ol className="space-y-2.5">
                {marcadosNaOrdem.map((p, i) => (
                  <li key={p.id} className="rounded-menuzia border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">{i + 1}</span>
                        <span className="rounded-menuzia bg-text-main px-1.5 py-0.5 text-xs font-bold text-white">#{p.numero}</span>
                        <span className="truncate text-[13px] font-semibold">{p.clienteNome || 'Cliente'}</span>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-semibold text-text-subtle">{tempoDesde(p.criadoEm)}</span>
                    </div>
                    <div className="mt-1 text-xs text-text-subtle">{endereco(p)}</div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge tone={p.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[p.formaPagamento]}</Badge>
                      {p.formaPagamento === 'dinheiro' && p.trocoPara !== null && (
                        <Badge tone="paused">Troco {brl(p.trocoPara)}</Badge>
                      )}
                      <span className="ml-auto text-[13px] font-bold text-price-text">{brl(p.total)}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex gap-2.5 border-t border-border p-4.5">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)} disabled={despachando}>
                Cancelar
              </Button>
              <Button variant="dispatch" className="flex-1" onClick={despachar} disabled={despachando}>
                {despachando ? 'Despachando…' : 'Despachar pedidos'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
