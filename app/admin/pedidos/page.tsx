'use client'

import { Children, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RotaPanel } from '@/components/pedidos/rota-panel'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { notificarPedido } from '@/lib/notificar'
import {
  avancarStatusPedido,
  listarPedidosConcluidos,
  listarPedidosKanban,
  listarPedidosLogistica,
  marcarPedidoEntregue,
  recusarPedido,
  type Pedido,
  type StatusPedido,
} from '@/lib/queries/pedidos'

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

type Coluna = 'recebido' | 'preparando' | 'pronto'

const COLUNA_LABELS: Record<Coluna, string> = {
  recebido: 'Pedido Recebido',
  preparando: 'Preparando',
  pronto: 'Pronto p/ Despacho',
}

const COLUNA_BORDER: Record<Coluna, string> = {
  recebido: 'border-t-status-pending',
  preparando: 'border-t-status-preparing',
  pronto: 'border-t-status-ready',
}

const COLUNA_HEADER: Record<Coluna, string> = {
  recebido: 'bg-status-pending/10 text-status-pending',
  preparando: 'bg-status-preparing/10 text-status-preparing',
  pronto: 'bg-status-ready/10 text-status-ready',
}

const TIMELINE_STEPS: { label: string; status: StatusPedido }[] = [
  { label: 'Recebido', status: 'recebido' },
  { label: 'Preparando', status: 'preparando' },
  { label: 'Pronto', status: 'pronto' },
  { label: 'Em rota', status: 'em_rota' },
  { label: 'Entregue', status: 'entregue' },
]

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`
const PAY_LABEL: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }

function tempoDecorrido(iso: string, now: number) {
  const totalSec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return { mins, label: `${mins}:${secs.toString().padStart(2, '0')}` }
}

function timerTone(mins: number) {
  if (mins < 10) return 'bg-price-bg text-price-text'
  if (mins < 20) return 'bg-warn-bg text-warn'
  return 'bg-danger-bg text-danger'
}

/** Beep curto (dois tons) tocado quando um pedido novo chega via realtime. */
function playNewOrderSound() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const beep = (freq: number, start: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + 0.25)
    }
    beep(880, 0)
    beep(1175, 0.18)
    setTimeout(() => ctx.close(), 600)
  } catch {
    /* navegador sem suporte a Web Audio — silencioso */
  }
}

function resumoItens(p: Pedido): string[] {
  const linhas = p.itens.map((i) => `${i.quantidade}x ${i.nome}${i.tamanhoNome ? ` (${i.tamanhoNome})` : ''}${i.saborNome ? ` - ${i.saborNome}` : ''}`)
  if (linhas.length <= 3) return linhas
  return [...linhas.slice(0, 2), `+${linhas.length - 2} item(ns)`]
}

function SubSecao({ titulo, cor, vazio, children }: { titulo: string; cor: string; vazio: string; children: React.ReactNode }) {
  const count = Children.count(children)
  return (
    <div>
      <div className={`mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide ${cor}`}>
        <span>{titulo}</span>
        <span className="rounded-full bg-page px-1.5 text-text-subtle">{count}</span>
      </div>
      {count === 0 ? (
        <div className="rounded-menuzia border border-dashed border-border py-3 text-center text-[11px] text-text-subtle">{vazio}</div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function FluxoCard({ order, tone, onClick }: { order: Pedido; tone: 'transit' | 'done' | 'failed'; onClick: () => void }) {
  const bg = tone === 'done' ? 'bg-price-bg' : tone === 'failed' ? 'bg-danger-bg' : 'bg-white'
  const badge = tone === 'done' ? 'ok' : tone === 'failed' ? 'danger' : 'preparing'
  const label = tone === 'done' ? 'Entregue' : tone === 'failed' ? 'Não entregue' : 'Em rota'
  return (
    <button onClick={onClick} className={`w-full rounded-menuzia border border-border p-3 text-left transition-shadow hover:shadow-sm ${bg}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">#{order.numero}</span>
        <Badge tone={badge}>{label}</Badge>
      </div>
      <div className="mt-1 text-xs text-text-subtle">
        {order.clienteNome || 'Cliente'}
        {order.tipo === 'entrega' && order.enderecoBairro ? ` · ${order.enderecoBairro}` : ''}
      </div>
      <div className="mt-1 text-sm font-bold text-price-text">{brl(order.total)}</div>
    </button>
  )
}

const STAT_TINT: Record<string, { box: string; icon: string }> = {
  orange: { box: 'bg-status-pending/10', icon: 'text-status-pending' },
  blue: { box: 'bg-status-preparing/10', icon: 'text-status-preparing' },
  indigo: { box: 'bg-status-preparing/10', icon: 'text-status-preparing' },
  green: { box: 'bg-price-bg', icon: 'text-price-text' },
}

function StatCard({
  tint,
  value,
  label,
  icon,
  priceColor,
}: {
  tint: keyof typeof STAT_TINT
  value: React.ReactNode
  label: string
  icon: React.ReactNode
  priceColor?: boolean
}) {
  const t = STAT_TINT[tint]
  return (
    <div className="flex items-center gap-2.5 rounded-menuzia border border-border bg-white px-3 py-2">
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-menuzia ${t.box} ${t.icon}`}>{icon}</div>
      <div>
        <div className={`text-lg font-bold leading-none ${priceColor ? 'text-price-text' : ''}`}>{value}</div>
        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">{label}</div>
      </div>
    </div>
  )
}

const IconCheck = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
)
const IconClock = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)
const IconTruck = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 3h13v11H1zM14 7h4l3 3v4h-7" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
  </svg>
)
const IconMoney = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
)

export default function PedidosPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orders, setOrders] = useState<Pedido[]>([])
  const [transit, setTransit] = useState<Pedido[]>([])
  const [concluded, setConcluded] = useState<Pedido[]>([])
  const [detail, setDetail] = useState<Pedido | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [showCol4, setShowCol4] = useState(false)
  const [pulsando, setPulsando] = useState<Set<string>>(new Set())
  const recebidosConhecidos = useRef<Set<string> | null>(null)
  const [somAtivo, setSomAtivo] = useState(true)
  const somRef = useRef(true)
  const [focusMode, setFocusMode] = useState(false)
  const [rotaOpen, setRotaOpen] = useState(false)
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  // restaura preferências (4º kanban e som)
  useEffect(() => {
    setShowCol4(localStorage.getItem('menuzia:kanban-col4') === '1')
    const som = localStorage.getItem('menuzia:kanban-som') !== '0'
    setSomAtivo(som)
    somRef.current = som
  }, [])

  function toggleSom() {
    setSomAtivo((v) => {
      const next = !v
      somRef.current = next
      localStorage.setItem('menuzia:kanban-som', next ? '1' : '0')
      return next
    })
  }

  // modo tela cheia: esconde a sidebar e entra em fullscreen do navegador
  async function toggleFocus() {
    const next = !focusMode
    setFocusMode(next)
    window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: next }))
    try {
      if (next) await document.documentElement.requestFullscreen?.()
      else if (document.fullscreenElement) await document.exitFullscreen?.()
    } catch {
      /* navegador bloqueou fullscreen — modo foco continua valendo */
    }
  }

  // sincroniza quando o usuário sai do fullscreen pelo Esc + restaura sidebar ao sair da página
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) {
        setFocusMode(false)
        window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: false }))
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: false }))
    }
  }, [])

  function toggleCol4() {
    setShowCol4((v) => {
      const next = !v
      localStorage.setItem('menuzia:kanban-col4', next ? '1' : '0')
      return next
    })
  }

  const refetch = useCallback(
    async (id: string) => {
      try {
        const [kanban, logistica, finalizados] = await Promise.all([
          listarPedidosKanban(supabase, id),
          listarPedidosLogistica(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
        ])
        setOrders(kanban)
        setTransit(logistica.filter((p) => p.status === 'em_rota'))
        setConcluded(finalizados)

        // detecta pedidos novos (status "recebido") para tocar som e pulsar o card
        const recebidosAgora = new Set(kanban.filter((p) => p.status === 'recebido').map((p) => p.id))
        const anteriores = recebidosConhecidos.current
        if (anteriores) {
          const novos = [...recebidosAgora].filter((pid) => !anteriores.has(pid))
          if (novos.length > 0) {
            if (somRef.current) playNewOrderSound()
            setPulsando((prev) => new Set([...prev, ...novos]))
            for (const pid of novos) {
              setTimeout(() => {
                setPulsando((prev) => {
                  const next = new Set(prev)
                  next.delete(pid)
                  return next
                })
              }, 3000)
            }
          }
        }
        recebidosConhecidos.current = recebidosAgora
      } catch {
        setError('Não foi possível carregar os pedidos.')
      }
    },
    [supabase]
  )

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
      setRestauranteId(id)
      await refetch(id)
      setLoading(false)

      const channel = supabase
        .channel(`pedidos-kanban-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${id}` }, () => refetch(id))
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase, refetch])

  // relógio para os tempos decorridos (ticando a cada segundo)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  function colunaDe(p: Pedido): Coluna | null {
    if (p.status === 'recebido') return 'recebido'
    if (p.status === 'preparando') return 'preparando'
    if (p.status === 'pronto') return 'pronto'
    return null
  }

  async function avancar(p: Pedido) {
    let novo: StatusPedido | null = null
    if (p.status === 'recebido') novo = 'preparando'
    else if (p.status === 'preparando') novo = 'pronto'
    else if (p.status === 'pronto' && p.tipo === 'retirada') novo = 'entregue'
    if (!novo || !restauranteId) return

    // otimista
    setOrders((prev) =>
      novo === 'entregue' ? prev.filter((o) => o.id !== p.id) : prev.map((o) => (o.id === p.id ? { ...o, status: novo! } : o))
    )
    try {
      if (novo === 'entregue') await marcarPedidoEntregue(supabase, p.id)
      else await avancarStatusPedido(supabase, p.id, novo)
      if (novo === 'preparando' || novo === 'pronto') notificarPedido(p.id, novo)
    } catch {
      setError('Não foi possível atualizar o pedido.')
      refetch(restauranteId)
    }
  }

  async function recusar(p: Pedido) {
    if (!restauranteId) return
    setOrders((prev) => prev.filter((o) => o.id !== p.id))
    try {
      await recusarPedido(supabase, p.id)
      refetch(restauranteId)
    } catch {
      setError('Não foi possível recusar o pedido.')
      refetch(restauranteId)
    }
  }

  const abertos = orders.length
  const emEntrega = transit.length
  const tempoMedioMin = orders.length
    ? Math.round(orders.reduce((s, o) => s + tempoDecorrido(o.criadoEm, now).mins, 0) / orders.length)
    : 0
  const faturamentoTurno =
    orders.reduce((s, o) => s + o.total, 0) +
    concluded.filter((o) => o.status === 'entregue').reduce((s, o) => s + o.total, 0)

  const topActions = (
    <>
      <div className="flex items-center gap-2 rounded-full bg-price-bg px-3 py-1.5 text-xs font-semibold text-price-text">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-price-text opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-price-text" />
        </span>
        Recebendo pedidos
      </div>
      <Button variant="outline" onClick={toggleSom} title={somAtivo ? 'Som ligado' : 'Som desligado'}>
        {somAtivo ? '🔔' : '🔕'} Som
      </Button>
      <Button variant="outline" onClick={() => setRotaOpen(true)} title="Despacho de rotas">
        🛵 Rotas
      </Button>
      <Button variant={showCol4 ? 'primary' : 'outline'} onClick={toggleCol4}>
        {showCol4 ? '✓ Coluna de entregas' : '+ Coluna de entregas'}
      </Button>
      <Button variant="outline" onClick={toggleFocus} title={focusMode ? 'Sair da tela cheia' : 'Tela cheia'}>
        {focusMode ? '✕ Sair' : '⛶ Tela cheia'}
      </Button>
    </>
  )

  if (loading) {
    return (
      <>
        <TopBar title="Painel de Pedidos" breadcrumb="Pedidos › Kanban" right={topActions} />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando pedidos…</div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Painel de Pedidos" breadcrumb="Pedidos › Kanban" right={topActions} />

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-5">
        {error && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}

        {/* Stats — barra de métricas acima dos kanbans (oculta em tela cheia) */}
        {!focusMode && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard tint="orange" value={abertos} label="Pedidos abertos" icon={IconCheck} />
            <StatCard tint="blue" value={`${tempoMedioMin} min`} label="Tempo médio" icon={IconClock} />
            <StatCard tint="indigo" value={emEntrega} label="Em entrega" icon={IconTruck} />
            <StatCard tint="green" value={brl(faturamentoTurno)} label="Faturamento do turno" icon={IconMoney} priceColor />
          </div>
        )}

        {/* Board */}
        <div className={`grid flex-1 grid-cols-1 gap-3 overflow-hidden ${showCol4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          {(['recebido', 'preparando', 'pronto'] as Coluna[]).map((coluna) => {
            const colOrders = orders.filter((o) => colunaDe(o) === coluna)
            return (
              <div key={coluna} className={`flex flex-col overflow-hidden rounded-menuzia border border-border border-t-[3px] bg-white ${COLUNA_BORDER[coluna]}`}>
                <div className={`flex items-center justify-between border-b border-border px-4 py-3 ${COLUNA_HEADER[coluna]}`}>
                  <h3 className="text-sm font-bold">{COLUNA_LABELS[coluna]}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-text-subtle">{colOrders.length}</span>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3">
                  {colOrders.map((order) => {
                    const tempo = tempoDecorrido(order.criadoEm, now)
                    return (
                      <div
                        key={order.id}
                        className={[
                          'rounded-menuzia border border-border bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md',
                          pulsando.has(order.id) ? 'animate-new-order' : '',
                        ].join(' ')}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-menuzia bg-text-main px-1.5 py-0.5 text-sm font-bold text-white">#{order.numero}</span>
                            {order.status === 'recebido' && <Badge tone="new">Novo</Badge>}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`rounded-menuzia px-2 py-0.5 text-[11px] font-bold tabular-nums ${timerTone(tempo.mins)}`}>{tempo.label}</span>
                            <Badge tone={order.tipo === 'entrega' ? 'alert' : 'paused'}>{order.tipo === 'entrega' ? 'Entrega' : 'Retirada'}</Badge>
                          </div>
                        </div>
                        <div className="mb-3 flex gap-2">
                          {/* Esquerda: informações do pedido (~75%) */}
                          <div className="min-w-0 flex-[3]">
                            <div className="mb-1 text-[13px] font-semibold">{order.clienteNome || 'Cliente'}</div>
                            {order.tipo === 'entrega' && order.enderecoBairro && (
                              <div className="mb-2 text-xs text-text-subtle">{order.enderecoBairro}</div>
                            )}
                            <ul className="space-y-0.5 text-xs text-text-subtle">
                              {resumoItens(order).map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </div>

                          {/* Divisória interna invisível (mantém o espaçamento) */}
                          <div className="w-px self-stretch bg-transparent" />

                          {/* Direita: boxes de pagamento ~25% (espaço acima para tags futuras) */}
                          <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1.5">
                            {/* slot para tags futuras (ex.: agendado, atrasado) */}
                            <div className="truncate rounded-menuzia border border-border px-1.5 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-subtle">
                              {PAY_LABEL[order.formaPagamento]}
                            </div>
                            <div className="rounded-menuzia bg-price-bg px-1.5 py-1.5 text-center text-[13px] font-bold text-price-text">
                              {brl(order.total)}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="secondary" className="flex-1" onClick={() => setDetail(order)}>
                            Detalhes
                          </Button>
                          {order.status === 'recebido' && (
                            <>
                              <Button variant="primary" className="flex-1" onClick={() => avancar(order)}>
                                Aceitar
                              </Button>
                              <Button
                                variant="outline"
                                className="border-danger px-2.5 text-danger hover:bg-danger-bg"
                                onClick={() => recusar(order)}
                                title="Recusar pedido"
                              >
                                ✕
                              </Button>
                            </>
                          )}
                          {order.status === 'preparando' && (
                            <Button variant="success" className="flex-1" onClick={() => avancar(order)}>
                              Pronto
                            </Button>
                          )}
                          {order.status === 'pronto' && order.tipo === 'retirada' && (
                            <Button variant="success" className="flex-1" onClick={() => avancar(order)}>
                              Entregue
                            </Button>
                          )}
                          {order.status === 'pronto' && order.tipo === 'entrega' && (
                            <span className="flex flex-1 items-center justify-center rounded-menuzia bg-page text-[11px] font-semibold uppercase text-text-subtle">
                              Na logística
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {colOrders.length === 0 && (
                    <div className="flex h-full items-center justify-center py-10 text-xs text-text-subtle">Nenhum pedido nesta etapa</div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 4ª coluna opcional: entregas e concluídos */}
          {showCol4 && (
            <div className="flex flex-col overflow-hidden rounded-menuzia border border-border border-t-[3px] border-t-purple bg-white">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Entregas & concluídos</h3>
                <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{transit.length + concluded.length}</span>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-3">
                <SubSecao titulo="Em trânsito" cor="text-status-preparing" vazio="Ninguém em rota">
                  {transit.map((o) => (
                    <FluxoCard key={o.id} order={o} tone="transit" onClick={() => setDetail(o)} />
                  ))}
                </SubSecao>
                <SubSecao titulo="Concluídos" cor="text-price-text" vazio="Nada concluído hoje">
                  {concluded.filter((o) => o.status === 'entregue').map((o) => (
                    <FluxoCard key={o.id} order={o} tone="done" onClick={() => setDetail(o)} />
                  ))}
                </SubSecao>
                <SubSecao titulo="Não concluídos" cor="text-danger" vazio="Nenhum recusado hoje">
                  {concluded.filter((o) => o.status === 'cancelado').map((o) => (
                    <FluxoCard key={o.id} order={o} tone="failed" onClick={() => setDetail(o)} />
                  ))}
                </SubSecao>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Painel de despacho de rotas */}
      {rotaOpen && restauranteId && (
        <RotaPanel supabase={supabase} restauranteId={restauranteId} apiKey={mapsKey} onClose={() => setRotaOpen(false)} />
      )}

      {/* Drawer de detalhes */}
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
                <h2 className="text-[15px] font-bold">Pedido #{detail.numero}</h2>
                <p className="mt-0.5 text-xs text-text-subtle">{detail.clienteNome || 'Cliente'} · {detail.tipo === 'entrega' ? 'Entrega' : 'Retirada'}</p>
              </div>
              <button onClick={() => setDetail(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5">
              <div className="mb-5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Linha do tempo</div>
              <div className="mb-6 space-y-0">
                {TIMELINE_STEPS.map((step, index) => {
                  const active = TIMELINE_STEPS.findIndex((s) => s.status === detail.status)
                  const done = index < active || detail.status === 'entregue'
                  const current = index === active && detail.status !== 'entregue'
                  return (
                    <div key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
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
                      <span className={`text-sm font-medium ${done || current ? 'text-text-main' : 'text-text-subtle'}`}>{step.label}</span>
                    </div>
                  )
                })}
              </div>

              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Itens do pedido</div>
              <ul className="mb-5 space-y-2 rounded-menuzia border border-border p-3 text-sm">
                {detail.itens.map((linha) => (
                  <li key={linha.id}>
                    <div className="flex justify-between text-text-main">
                      <span>
                        {linha.quantidade}x {linha.nome}
                        {linha.tamanhoNome && <span className="text-text-subtle"> · {linha.tamanhoNome}</span>}
                        {linha.saborNome && <span className="text-text-subtle"> · {linha.saborNome}</span>}
                      </span>
                      <span className="font-semibold">{brl(linha.precoUnitario * linha.quantidade)}</span>
                    </div>
                    {(linha.bordaNome || linha.massaNome) && (
                      <div className="mt-0.5 text-xs text-text-subtle">{[linha.bordaNome, linha.massaNome].filter(Boolean).join(', ')}</div>
                    )}
                    {linha.complementos.length > 0 && (
                      <div className="mt-0.5 text-xs text-text-subtle">{linha.complementos.map((c) => c.nome).join(', ')}</div>
                    )}
                    {linha.observacao && <div className="mt-0.5 text-xs italic text-text-subtle">obs: {linha.observacao}</div>}
                  </li>
                ))}
                <li className="flex justify-between border-t border-border pt-2 text-text-subtle"><span>Subtotal</span><span>{brl(detail.subtotal)}</span></li>
                {detail.taxaEntrega > 0 && (
                  <li className="flex justify-between text-text-subtle"><span>Taxa de entrega</span><span>{brl(detail.taxaEntrega)}</span></li>
                )}
                <li className="flex justify-between font-bold"><span>Total</span><span className="text-price-text">{brl(detail.total)}</span></li>
              </ul>

              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cliente & pagamento</div>
              <div className="mb-5 space-y-1.5 rounded-menuzia border border-border p-3 text-sm">
                <div className="flex justify-between"><span className="text-text-subtle">Cliente</span><span className="font-medium">{detail.clienteNome || '—'}</span></div>
                {detail.clienteTelefone && <div className="flex justify-between"><span className="text-text-subtle">Telefone</span><span className="font-medium">{detail.clienteTelefone}</span></div>}
                <div className="flex justify-between"><span className="text-text-subtle">Pagamento</span><span className="font-medium">{PAY_LABEL[detail.formaPagamento]}</span></div>
                {detail.formaPagamento === 'dinheiro' && detail.trocoPara !== null && (
                  <div className="flex justify-between"><span className="text-text-subtle">Troco para</span><span className="font-medium">{brl(detail.trocoPara)}</span></div>
                )}
                <div className="flex justify-between">
                  <span className="text-text-subtle">Status</span>
                  <Badge tone={detail.pago ? 'ok' : 'pending'}>{detail.pago ? 'Pago' : 'A receber'}</Badge>
                </div>
              </div>

              {detail.tipo === 'entrega' && (
                <>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Endereço de entrega</div>
                  <div className="rounded-menuzia border border-border p-3 text-sm text-text-main">
                    {detail.enderecoRua}, {detail.enderecoNumero}
                    {detail.enderecoComplemento && ` · ${detail.enderecoComplemento}`}
                    <div className="text-text-subtle">{detail.enderecoBairro}{detail.enderecoCep && ` · ${detail.enderecoCep}`}</div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  )
}
