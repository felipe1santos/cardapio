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
  listarPedidosRotas,
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
  eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 7.61 17 4.5 12 4.5zm0 12a4.5 4.5 0 110-9 4.5 4.5 0 010 9zm0-7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  eyeOff: 'M12 6.5c2.76 0 5 2.24 5 5 0 .51-.1 1-.24 1.46l3.06 3.06c1.39-1.23 2.49-2.77 3.18-4.52-1.73-4.39-6-7.5-11-7.5-1.27 0-2.49.2-3.64.57l2.17 2.17c.47-.14.96-.24 1.51-.24zM2.71 3.16a.996.996 0 000 1.41l1.97 1.97A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.52 0 2.98-.29 4.32-.82l2.72 2.72a.996.996 0 101.41-1.41L4.13 3.16a.996.996 0 00-1.42 0zM12 17.5c-2.76 0-5-2.24-5-5 0-.77.18-1.5.49-2.14l1.57 1.57c-.03.18-.06.37-.06.57a2.5 2.5 0 002.5 2.5c.2 0 .38-.03.57-.07l1.57 1.57c-.65.32-1.37.5-2.14.5z',
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

const JANELA_HORAS = 12

type StatusKey = 'pronto' | 'em_rota' | 'entregue' | 'cancelado'

const STATUS_KEYS: StatusKey[] = ['pronto', 'em_rota', 'entregue', 'cancelado']

/** Chavinhas (olho liga/desliga) que controlam quais pontos aparecem no mapa. */
const MAPA_TABS: { id: StatusKey; label: string; dot: string }[] = [
  { id: 'pronto', label: 'Aguardando', dot: '#0688D4' },
  { id: 'em_rota', label: 'Em rota', dot: '#111827' },
  { id: 'entregue', label: 'Entregues', dot: '#16A34A' },
  { id: 'cancelado', label: 'Cancelados', dot: '#DC2626' },
]

/** Cor do pino no mapa conforme o ciclo do pedido. */
function corPino(p: Pedido, marcado: boolean): string {
  if (p.status === 'pronto') return marcado ? '#FACC15' : '#0688D4'
  if (p.status === 'em_rota') return '#111827' // preto = despachado/em rota
  if (p.status === 'entregue') return '#16A34A' // verde = entregue
  return '#DC2626' // vermelho = cancelado/não entregue
}

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
  const [mapaFiltros, setMapaFiltros] = useState<Set<StatusKey>>(new Set(STATUS_KEYS))
  const [motoboysVisiveis, setMotoboysVisiveis] = useState<Set<string>>(new Set())

  const [locDriverId, setLocDriverId] = useState<string | null>(null)
  const [perfilDriver, setPerfilDriver] = useState<Entregador | null>(null)

  const refetch = useCallback(async () => {
    try {
      const desde = new Date(Date.now() - JANELA_HORAS * 3600 * 1000).toISOString()
      const [rotas, entregadores] = await Promise.all([
        listarPedidosRotas(supabase, restauranteId, desde),
        listarEntregadores(supabase, restauranteId),
      ])
      const prontos = rotas.filter((o) => o.status === 'pronto' && !o.entregadorId)
      setTodos(rotas)
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

  const passaFunnel = useCallback(
    (p: Pedido) => {
      if (filtros.pgto !== 'todos' && p.formaPagamento !== filtros.pgto) return false
      const q = filtros.busca.trim().toLowerCase()
      if (q) {
        const hay = `#${p.numero} ${p.clienteNome} ${p.enderecoBairro} ${p.enderecoRua} ${p.enderecoNumero}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    },
    [filtros]
  )

  // Pedidos visíveis no MAPA: cada status entra só se a chavinha (olho) dele estiver ligada
  const visiveis = useMemo(
    () => todos.filter((p) => mapaFiltros.has(p.status as StatusKey) && passaFunnel(p)),
    [todos, mapaFiltros, passaFunnel]
  )

  // Lista da esquerda: SOMENTE pedidos aguardando despacho (prontos sem entregador), na ordem do arraste
  const listaEsquerda = useMemo(() => ordenados.filter((p) => passaFunnel(p)), [ordenados, passaFunnel])

  const contagem = useMemo(() => {
    const c: Record<StatusKey, number> = { pronto: 0, em_rota: 0, entregue: 0, cancelado: 0 }
    for (const p of todos) if (p.status in c) c[p.status as StatusKey]++
    return c
  }, [todos])

  const todosLigados = mapaFiltros.size === STATUS_KEYS.length

  function toggleMapaStatus(k: StatusKey) {
    setMapaFiltros((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }
  function toggleTodosMapa() {
    setMapaFiltros(todosLigados ? new Set() : new Set(STATUS_KEYS))
  }

  const filtrosAtivos = filtros.busca.trim() !== '' || filtros.pgto !== 'todos'

  const stops = visiveis.map((p) => ({
    id: p.id,
    label: `#${p.numero}`,
    address: enderecoCompletoPedido(p),
    color: corPino(p, marcados.has(p.id)),
    clickable: p.status === 'pronto',
  }))

  const driverMarkers = drivers
    .filter((d) => motoboysVisiveis.has(d.id) && d.localizacao)
    .map((d) => ({ id: d.id, lat: d.localizacao!.lat, lng: d.localizacao!.lng, nome: d.nome }))

  function toggleMotoboyVisivel(id: string) {
    setMotoboysVisiveis((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-bold">Despacho de rotas</h2>
              <p className="mt-0.5 text-xs text-text-subtle">Visão do dia (últimas {JANELA_HORAS}h) — marque os pedidos e atribua a um entregador.</p>
            </div>
            <button
              onClick={onClose}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border"
            >
              ×
            </button>
          </div>
          {/* Chavinhas (olho liga/desliga) — controlam o que aparece no MAPA */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">Mostrar no mapa</span>
            <button
              onClick={toggleTodosMapa}
              title={todosLigados ? 'Esconder todos do mapa' : 'Mostrar todos no mapa'}
              className={[
                'inline-flex items-center gap-1.5 rounded-menuzia border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                todosLigados ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
              ].join(' ')}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d={todosLigados ? ICON.eye : ICON.eyeOff} />
              </svg>
              Todos
            </button>
            {MAPA_TABS.map((t) => {
              const on = mapaFiltros.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleMapaStatus(t.id)}
                  title={on ? `Esconder "${t.label}" do mapa` : `Mostrar "${t.label}" no mapa`}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-menuzia border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    on ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
                  ].join(' ')}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                    <path d={on ? ICON.eye : ICON.eyeOff} />
                  </svg>
                  <span className="inline-flex h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: on ? '#FFFFFF' : t.dot }} />
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-white/25 text-white' : 'bg-page text-text-subtle'}`}>{contagem[t.id]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {error && <div className="border-b border-danger bg-danger-bg px-4 py-2 text-[13px] font-medium text-danger">{error}</div>}

        {/* Corpo: mapa de fundo + colunas flutuantes */}
        <div className="relative flex-1 overflow-hidden bg-page">
          <RotaMap apiKey={apiKey} stops={stops} drivers={driverMarkers} onStopClick={toggleMarcado} className="absolute inset-0 h-full w-full" />

          {/* Coluna esquerda: pedidos prontos (corpo quase transparente, título preto, cresce com o conteúdo) */}
          <aside className="absolute left-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[330px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-menuzia border border-white/15 bg-white/5 shadow-2xl backdrop-blur-sm">
            <div className="flex-shrink-0 bg-black px-3 py-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Aguardando despacho</h3>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">{listaEsquerda.length}</span>
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
            <div className="min-h-0 space-y-2 overflow-y-auto p-2.5">
              {listaEsquerda.length === 0 && (
                <div className="m-1 rounded-menuzia bg-black/50 px-2 py-6 text-center text-xs text-white">
                  {filtrosAtivos ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido aguardando despacho.'}
                </div>
              )}
              {listaEsquerda.map((p) => {
                // Todos aqui são pedidos prontos aguardando despacho = card interativo (marcável e arrastável)
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
                      'cursor-pointer select-none overflow-hidden rounded-menuzia border-l-4 shadow-md transition-all',
                      ativo ? 'border-l-yellow-500 ring-2 ring-yellow-400' : 'border-l-green-600',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-2 bg-black px-2.5 py-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="text-white/40">⠿</span>
                        <span className="rounded-menuzia bg-status-pending px-1.5 py-0.5 text-xs font-bold text-white">#{p.numero}</span>
                        <span className="truncate text-[13px] font-semibold text-white">{p.clienteNome || 'Cliente'}</span>
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-semibold text-white/70">{tempoDesde(p.criadoEm)}</span>
                    </div>
                    <div className={ativo ? 'bg-yellow-200 px-2.5 py-2' : 'bg-green-200 px-2.5 py-2'}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.enderecoRua && <span className="text-xs font-medium text-text-main">{p.enderecoRua}, {p.enderecoNumero}</span>}
                        {p.enderecoBairro && (
                          <span className="flex-shrink-0 rounded bg-green-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{p.enderecoBairro}</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Badge tone={p.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[p.formaPagamento]}</Badge>
                        {p.formaPagamento === 'dinheiro' && p.trocoPara !== null && <Badge tone="paused">Troco {brl(p.trocoPara)}</Badge>}
                        <span className="ml-auto text-[13px] font-extrabold text-green-700">{brl(p.total)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Coluna direita: entregadores (corpo quase transparente, título preto, cresce com o conteúdo) */}
          <aside className="absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[280px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-menuzia border border-white/15 bg-white/5 shadow-2xl backdrop-blur-sm">
            <div className="flex flex-shrink-0 items-center justify-between bg-black px-3 py-2.5">
              <h3 className="text-sm font-bold text-white">Entregadores</h3>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">{disponiveis.length} online</span>
            </div>
            <div className="min-h-0 space-y-2 overflow-y-auto p-2.5">
              {disponiveis.length === 0 && <div className="m-1 rounded-menuzia bg-black/50 px-2 py-6 text-center text-xs text-white">Nenhum entregador online no momento.</div>}
              {disponiveis.map((d) => {
                const sel = d.id === motoboyId
                return (
                  <div
                    key={d.id}
                    onClick={() => setMotoboyId(sel ? null : d.id)}
                    className={[
                      'flex cursor-pointer items-center gap-2 rounded-menuzia border-2 bg-white p-1.5 shadow-sm transition-colors',
                      sel ? 'border-primary ring-2 ring-primary/30' : 'border-primary/40 hover:border-primary',
                    ].join(' ')}
                  >
                    {/* moto + nome + nº de pedidos */}
                    <span className="flex-shrink-0 text-lg leading-none">🛵</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-main">{d.nome}</span>
                    <span
                      title={`${d.emRota} pedido(s) em rota`}
                      className={[
                        'flex h-7 min-w-[28px] flex-shrink-0 items-center justify-center rounded-menuzia px-1.5 text-base font-extrabold',
                        d.emRota > 0 ? 'bg-yellow-300 text-black' : 'bg-green-500 text-white',
                      ].join(' ')}
                    >
                      {d.emRota}
                    </span>
                    {/* olho (mostra a moto no mapa) + localização + perfil */}
                    <div className="flex flex-shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const visivel = motoboysVisiveis.has(d.id)
                        const semLoc = !d.localizacao
                        return (
                          <button
                            onClick={() => toggleMotoboyVisivel(d.id)}
                            disabled={semLoc}
                            title={semLoc ? 'Localização indisponível' : visivel ? 'Esconder moto do mapa' : 'Mostrar moto no mapa'}
                            className={[
                              'flex h-7 w-7 items-center justify-center rounded-menuzia transition-colors',
                              semLoc ? 'cursor-not-allowed bg-border text-text-subtle' : visivel ? 'bg-text-main text-white hover:opacity-90' : 'bg-white text-text-subtle ring-1 ring-border hover:text-text-main',
                            ].join(' ')}
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                              <path d={visivel && !semLoc ? ICON.eye : ICON.eyeOff} />
                            </svg>
                          </button>
                        )
                      })()}
                      <button
                        onClick={() => setLocDriverId(d.id)}
                        title="Ver localização e rota em tempo real"
                        className="flex h-7 w-7 items-center justify-center rounded-menuzia bg-primary text-white transition-colors hover:bg-primary-dark"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                          <path d={ICON.pin} />
                        </svg>
                      </button>
                      <button
                        onClick={() => setPerfilDriver(d)}
                        title="Perfil do entregador"
                        className="flex h-7 w-7 items-center justify-center rounded-menuzia bg-purple text-white transition-colors hover:bg-purple-600"
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
