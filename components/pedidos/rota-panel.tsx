'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RotaMap } from '@/components/pedidos/rota-map'
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

function tempoRelativo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)}h`
}

function endereco(p: Pedido) {
  const partes = [p.enderecoRua && `${p.enderecoRua}, ${p.enderecoNumero}`, p.enderecoBairro].filter(Boolean)
  return partes.join(' · ') || 'Entrega'
}

/** Chave de ordenação: só o nome do bairro (agrupa pedidos da mesma região). */
function chaveEndereco(p: Pedido) {
  return p.enderecoBairro.trim().toLowerCase()
}

const ICON = {
  phone: 'M6.62,10.79c1.44,2.83,3.76,5.14,6.59,6.59l2.2-2.2c0.27-0.27,0.67-0.36,1.02-0.24c1.12,0.37,2.33,0.57,3.57,0.57 c0.55,0,1,0.45,1,1V20c0,0.55-0.45,1-1,1C10.61,21,3,13.39,3,4c0-0.55,0.45-1,1-1h3.5c0.55,0,1,0.45,1,1 c0,1.25,0.2,2.45,0.57,3.57c0.11,0.35,0.03,0.74-0.25,1.02L6.62,10.79z',
  pin: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
  user: 'M12,12c2.21,0,4-1.79,4-4c0-2.21-1.79-4-4-4S8,5.79,8,8C8,10.21,9.79,12,12,12z M12,14c-2.67,0-8,1.34-8,4v2h16v-2 C20,15.34,14.67,14,12,14z',
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

interface RotaPanelProps {
  supabase: SupabaseClient
  restauranteId: string
  apiKey?: string
  onClose: () => void
}

export function RotaPanel({ supabase, restauranteId, apiKey, onClose }: RotaPanelProps) {
  const [todos, setTodos] = useState<Pedido[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [drivers, setDrivers] = useState<Entregador[]>([])
  const [ordem, setOrdem] = useState<string[]>([])
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [motoboyId, setMotoboyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [despachando, setDespachando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragIndex = useRef<number | null>(null)

  const [filtroOpen, setFiltroOpen] = useState(false)
  const [filtros, setFiltros] = useState<{ busca: string; pgto: 'todos' | 'pix' | 'cartao' | 'dinheiro' }>({ busca: '', pgto: 'todos' })

  const [locDriverId, setLocDriverId] = useState<string | null>(null)
  const [perfilDriver, setPerfilDriver] = useState<Entregador | null>(null)

  const refetch = useCallback(async () => {
    try {
      const [logistica, entregadores] = await Promise.all([
        listarPedidosLogistica(supabase, restauranteId),
        listarEntregadores(supabase, restauranteId),
      ])
      const prontos = logistica.filter((o) => o.status === 'pronto' && !o.entregadorId)
      setTodos(logistica)
      setPedidos(prontos)
      setDrivers(entregadores)
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
  const locDriver = drivers.find((d) => d.id === locDriverId) ?? null

  const filtrados = useMemo(() => {
    const q = filtros.busca.trim().toLowerCase()
    return ordenados.filter((p) => {
      if (filtros.pgto !== 'todos' && p.formaPagamento !== filtros.pgto) return false
      if (q) {
        const hay = `#${p.numero} ${p.clienteNome} ${p.enderecoBairro} ${p.enderecoRua} ${p.enderecoNumero}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [ordenados, filtros])

  const filtrosAtivos = filtros.busca.trim() !== '' || filtros.pgto !== 'todos'

  const stops = filtrados.map((p) => ({
    id: p.id,
    label: `#${p.numero}`,
    address: enderecoCompletoPedido(p),
    active: marcados.has(p.id),
  }))

  const locStops = locDriver
    ? todos
        .filter((o) => o.entregadorId === locDriver.id && o.status === 'em_rota')
        .map((o, i) => ({ id: o.id, numero: i + 1, address: enderecoCompletoPedido(o) }))
    : []

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
            <p className="mt-0.5 text-xs text-text-subtle">Marque os pedidos no mapa ou na lista e atribua a um entregador.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border"
          >
            ×
          </button>
        </div>

        {error && <div className="border-b border-danger bg-danger-bg px-4 py-2 text-[13px] font-medium text-danger">{error}</div>}

        {/* Corpo: mapa de fundo + colunas flutuantes */}
        <div className="relative flex-1 overflow-hidden bg-page">
          <RotaMap apiKey={apiKey} stops={stops} onStopClick={toggleMarcado} className="absolute inset-0 h-full w-full" />

          {/* Coluna esquerda: pedidos prontos (corpo translúcido, título preto) */}
          <aside className="absolute bottom-3 left-3 top-3 flex w-[330px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-menuzia border border-white/30 bg-white/10 shadow-2xl backdrop-blur-md">
            <div className="bg-black px-3 py-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Pedidos prontos</h3>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">{filtrados.length}</span>
                  <button
                    onClick={() => setFiltroOpen((v) => !v)}
                    title="Filtrar"
                    className={`flex h-7 w-7 items-center justify-center rounded-menuzia border transition-colors ${
                      filtroOpen || filtrosAtivos ? 'border-primary bg-primary text-white' : 'border-white/20 text-white/80 hover:bg-white/10'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                      <path d="M3 5h18l-7 8v6l-4-2v-4z" />
                    </svg>
                  </button>
                </div>
              </div>
              {filtroOpen && (
                <div className="mt-2.5 space-y-2">
                  <input
                    value={filtros.busca}
                    onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                    placeholder="Buscar nº, cliente, bairro, rua…"
                    className="w-full rounded-menuzia border border-white/15 bg-white/10 px-2.5 py-1.5 font-sans text-[12px] text-white placeholder:text-white/40 outline-none focus:border-primary"
                  />
                  <div className="flex items-center gap-1.5">
                    {(['todos', 'pix', 'cartao', 'dinheiro'] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setFiltros((f) => ({ ...f, pgto: p }))}
                        className={`flex-1 rounded-menuzia border px-1 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                          filtros.pgto === p ? 'border-primary bg-primary text-white' : 'border-white/15 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {p === 'todos' ? 'Todos' : PAY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                  {filtrosAtivos && (
                    <button onClick={() => setFiltros({ busca: '', pgto: 'todos' })} className="text-[11px] font-semibold text-white/60 hover:text-white">
                      Limpar filtros
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {filtrados.length === 0 && (
                <div className="m-1 rounded-menuzia bg-black/50 px-2 py-6 text-center text-xs text-white">
                  {ordenados.length === 0 ? 'Nenhum pedido pronto aguardando entrega.' : 'Nenhum pedido com esses filtros.'}
                </div>
              )}
              {filtrados.map((p) => {
                const ativo = marcados.has(p.id)
                const idx = ordenados.findIndex((o) => o.id === p.id)
                return (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDragEnd={onDragEnd}
                    onClick={() => toggleMarcado(p.id)}
                    className={[
                      'cursor-pointer select-none rounded-menuzia border-l-4 p-2.5 shadow-sm transition-colors',
                      ativo
                        ? 'border-l-yellow-500 bg-yellow-300 text-black'
                        : 'border-l-green-600 bg-green-100 hover:bg-green-200',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={ativo ? 'text-black/40' : 'text-green-700/50'}>⠿</span>
                        <span className="rounded-menuzia bg-text-main px-1.5 py-0.5 text-xs font-bold text-white">#{p.numero}</span>
                        <span className="truncate text-[13px] font-semibold">{p.clienteNome || 'Cliente'}</span>
                      </div>
                      <span className={`flex-shrink-0 text-[11px] font-semibold ${ativo ? 'text-black/70' : 'text-text-subtle'}`}>{tempoDesde(p.criadoEm)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {p.enderecoBairro && (
                        <span className="flex-shrink-0 rounded bg-[#DC0101] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{p.enderecoBairro}</span>
                      )}
                      {p.enderecoRua && (
                        <span className={`truncate text-xs ${ativo ? 'text-black/80' : 'text-text-subtle'}`}>{p.enderecoRua}, {p.enderecoNumero}</span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge tone={p.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[p.formaPagamento]}</Badge>
                      {p.formaPagamento === 'dinheiro' && p.trocoPara !== null && <Badge tone="paused">Troco {brl(p.trocoPara)}</Badge>}
                      <span className={`ml-auto text-[13px] font-bold ${ativo ? 'text-black' : 'text-price-text'}`}>{brl(p.total)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Coluna direita: entregadores (corpo translúcido, título preto) */}
          <aside className="absolute bottom-3 right-3 top-3 flex w-[280px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-menuzia border border-white/30 bg-white/10 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between bg-black px-3 py-2.5">
              <h3 className="text-sm font-bold text-white">Entregadores</h3>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">{disponiveis.length} online</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
              {disponiveis.length === 0 && <div className="m-1 rounded-menuzia bg-black/50 px-2 py-6 text-center text-xs text-white">Nenhum entregador online no momento.</div>}
              {disponiveis.map((d) => {
                const sel = d.id === motoboyId
                return (
                  <div
                    key={d.id}
                    onClick={() => setMotoboyId(sel ? null : d.id)}
                    className={[
                      'cursor-pointer rounded-menuzia border-2 bg-white p-2.5 shadow-sm transition-colors',
                      sel ? 'border-primary ring-2 ring-primary/30' : 'border-primary/40 hover:border-primary',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {d.fotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.fotoUrl} alt={d.nome} className="h-8 w-8 flex-shrink-0 rounded-menuzia border border-border object-cover" />
                        ) : (
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-menuzia bg-page text-sm font-bold text-text-subtle">
                            {d.nome.trim().charAt(0).toUpperCase() || '?'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-text-main">{d.nome}</div>
                          <div className="text-[11px] text-text-subtle">{d.emRota} em rota</div>
                        </div>
                      </div>
                      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${sel ? 'bg-primary' : 'bg-status-ready'}`} />
                    </div>
                    {/* Ações rápidas */}
                    <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2" onClick={(e) => e.stopPropagation()}>
                      {d.telefone ? (
                        <a
                          href={`tel:${d.telefone}`}
                          title={`Ligar para ${d.telefone}`}
                          className="flex flex-1 items-center justify-center rounded-menuzia bg-green-600 py-1.5 text-white transition-colors hover:bg-green-700"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <path d={ICON.phone} />
                          </svg>
                        </a>
                      ) : (
                        <span className="flex flex-1 items-center justify-center rounded-menuzia bg-green-600/40 py-1.5 text-white/70" title="Sem telefone">
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <path d={ICON.phone} />
                          </svg>
                        </span>
                      )}
                      <button
                        onClick={() => setLocDriverId(d.id)}
                        title="Ver localização e rota em tempo real"
                        className="flex flex-1 items-center justify-center rounded-menuzia bg-primary py-1.5 text-white transition-colors hover:bg-primary-dark"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                          <path d={ICON.pin} />
                        </svg>
                      </button>
                      <button
                        onClick={() => setPerfilDriver(d)}
                        title="Perfil do entregador"
                        className="flex flex-1 items-center justify-center rounded-menuzia bg-purple py-1.5 text-white transition-colors hover:bg-purple-600"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                          <path d={ICON.user} />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Botão despachar centralizado embaixo */}
          {marcadosNaOrdem.length > 0 && motoboy && (
            <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
              <button
                onClick={() => setConfirming(true)}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-menuzia bg-[#DC0101] px-6 py-3 text-[13px] font-bold uppercase tracking-wide text-white shadow-2xl transition-colors hover:bg-[#b00101]"
              >
                Despachar {marcadosNaOrdem.length} pedido{marcadosNaOrdem.length > 1 ? 's' : ''} → {motoboy.nome}
              </button>
            </div>
          )}
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
              <button onClick={() => !despachando && setConfirming(false)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
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
                      {p.formaPagamento === 'dinheiro' && p.trocoPara !== null && <Badge tone="paused">Troco {brl(p.trocoPara)}</Badge>}
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
              <button
                onClick={despachar}
                disabled={despachando}
                className="flex flex-1 items-center justify-center rounded-menuzia bg-[#DC0101] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#b00101] disabled:opacity-60"
              >
                {despachando ? 'Despachando…' : 'Despachar pedidos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de localização do entregador */}
      {locDriver && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[#111827]/60 p-4" onClick={() => setLocDriverId(null)}>
          <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-bold">Localização — {locDriver.nome}</h2>
                {locDriver.localizacao && <p className="mt-0.5 text-xs text-text-subtle">Atualizado {tempoRelativo(locDriver.localizacao.atualizadaEm)}</p>}
              </div>
              <button onClick={() => setLocDriverId(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 p-4.5">
              {locDriver.localizacao ? (
                <RouteMap apiKey={MAPS_KEY} origin={{ lat: locDriver.localizacao.lat, lng: locDriver.localizacao.lng }} stops={locStops} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center rounded-menuzia border border-dashed border-border p-8 text-center text-sm text-text-subtle">
                  Localização ainda não disponível. O motoboy precisa abrir o link de acesso e permitir a localização no celular.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de perfil do entregador */}
      {perfilDriver && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[#111827]/60 p-4" onClick={() => setPerfilDriver(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <h2 className="text-[15px] font-bold">Perfil do entregador</h2>
              <button onClick={() => setPerfilDriver(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="p-4.5">
              <div className="mb-4 flex items-center gap-3">
                {perfilDriver.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={perfilDriver.fotoUrl} alt={perfilDriver.nome} className="h-16 w-16 rounded-menuzia border border-border object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-bold text-text-subtle">
                    {perfilDriver.nome.trim().charAt(0).toUpperCase() || '?'}
                  </div>
                )}
                <div>
                  <div className="text-base font-bold">{perfilDriver.nome}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-subtle">
                    <span className={`h-2 w-2 rounded-full ${perfilDriver.online ? 'bg-status-ready' : 'bg-text-subtle'}`} />
                    {perfilDriver.online ? 'Online' : 'Offline'} · {perfilDriver.emRota} em rota
                  </div>
                </div>
              </div>
              <dl className="space-y-2.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-subtle">Telefone</dt>
                  <dd className="font-medium">
                    {perfilDriver.telefone ? (
                      <a href={`tel:${perfilDriver.telefone}`} className="text-primary hover:underline">
                        {perfilDriver.telefone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-subtle">Veículo</dt>
                  <dd className="font-medium">{perfilDriver.veiculo || '—'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-subtle">Placa</dt>
                  <dd className="font-medium">{perfilDriver.placa || '—'}</dd>
                </div>
                {perfilDriver.localizacao && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-text-subtle">Última localização</dt>
                    <dd className="font-medium">{tempoRelativo(perfilDriver.localizacao.atualizadaEm)}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-4 flex gap-2">
                {perfilDriver.telefone && (
                  <a
                    href={`tel:${perfilDriver.telefone}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-menuzia border border-border py-2 text-[12px] font-semibold uppercase tracking-wide text-text-subtle hover:border-primary hover:text-primary"
                  >
                    Ligar
                  </a>
                )}
                <button
                  onClick={() => {
                    setLocDriverId(perfilDriver.id)
                    setPerfilDriver(null)
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-menuzia border border-border py-2 text-[12px] font-semibold uppercase tracking-wide text-text-subtle hover:border-primary hover:text-primary"
                >
                  Ver no mapa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
