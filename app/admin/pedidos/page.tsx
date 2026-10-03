'use client'

import { mascararTelefoneBR } from '@/lib/telefone'
import { Children, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import {
  type LucideIcon,
  Bell,
  BellRing,
  BellOff,
  ChevronDown,
  MoreHorizontal,
  Volume2,
  Bike,
  Columns3,
  Maximize2,
  Minimize2,
  Inbox,
  ChefHat,
  HandPlatter,
  Clock,
  PrinterCheck,
  Eye,
  EyeOff,
  Zap,
} from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RotaPanel } from '@/components/pedidos/rota-panel'
import { CancelarPedidoModal } from '@/components/pedidos/cancelar-modal'
import { podeCancelar, rotuloMotivo } from '@/lib/cancelamento'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarFluxoLoja, buscarStatusELoja, definirStatusLoja, FLUXO_LOJA_PADRAO, usaDespachoDeRotas } from '@/lib/queries/ajustes'
import { lojaEstaAberta, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { notificarPedido } from '@/lib/notificar'
import { etiquetasDoPedido, referenciaDoLancamento, rotuloOrigemPedido as origemDoCard } from '@/lib/pedido-origem'
import { EtiquetaAtendimento, EtiquetasPedido } from '@/components/pedidos/etiquetas-pedido'
import { Capacete } from '@/components/icones/capacete'
import { pedidoParado, tempoParado } from '@/lib/pedido-parado'
import { AvisosPedidos, type Aviso } from '@/components/pedidos/avisos-pedidos'
import { useAlarmePedidos } from '@/components/pedidos/use-alarme'
import { OPCOES_REPETICAO, TEXTO_SOM_BLOQUEADO } from '@/lib/alarme-pedidos'
import { cancelarPedidoRequest } from '@/lib/cancelamento'
import { atualizarConfigImpressao, buscarConfigImpressao, solicitarReimpressao } from '@/lib/queries/impressao'
import {
  avancarStatusPedido,
  listarPedidosConcluidos,
  listarPedidosKanban,
  listarPedidosLogistica,
  marcarPedidoEntregue,
  proximoStatusKanban,
  type Pedido,
  type StatusPedido,
} from '@/lib/queries/pedidos'
import { formatarReal } from '@/lib/moeda'
import { CartaoNumero } from '@/components/admin/cartao-numero'
import { ICONES } from '@/lib/icones-painel'
import { pedidoLiberado, textoAgendado } from '@/lib/agendamento'
import { AlertaTroco, InfoPagamento } from '@/components/pedidos/info-pagamento'
import { EditorPagamento } from '@/components/pedidos/editor-pagamento'

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

type Coluna = 'recebido' | 'preparando' | 'pronto'

interface ColunaConfig {
  label: string
  headerBg: string
  Icon: LucideIcon
  emptyTitle: string
  EmptyIcon: LucideIcon
}

const COLUNA_CONFIG: Record<Coluna, ColunaConfig> = {
  recebido: {
    label: 'Pedido Recebido',
    headerBg: 'bg-status-pending',
    Icon: Inbox,
    emptyTitle: 'Nenhum pedido novo',
    EmptyIcon: Inbox,
  },
  preparando: {
    label: 'Preparando',
    headerBg: 'bg-[#024A7D]',
    Icon: ChefHat,
    emptyTitle: 'Nada em preparo',
    EmptyIcon: ChefHat,
  },
  pronto: {
    label: 'Pronto p/ Despacho',
    headerBg: 'bg-status-ready',
    Icon: HandPlatter,
    emptyTitle: 'Nada pronto ainda',
    EmptyIcon: HandPlatter,
  },
}


const TIMELINE_STEPS: { label: string; status: StatusPedido }[] = [
  { label: 'Recebido', status: 'recebido' },
  { label: 'Preparando', status: 'preparando' },
  { label: 'Pronto', status: 'pronto' },
  { label: 'Em rota', status: 'em_rota' },
  { label: 'Entregue', status: 'entregue' },
]

// Milhar com ponto ("R$ 4.088,00"): função única do painel, ver lib/moeda.ts.
const brl = formatarReal

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

/** Com o aceite automático ligado, o pedido toca o alarme por esse tempo antes de ir sozinho pra "Preparando". */
const AUTO_ACEITE_DELAY_MS = 5_000


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

/** Estado vazio de uma coluna do Kanban: ilustração cinza-clara em vez de texto solto. */
function ColunaVazia({ Icon, titulo }: { Icon: LucideIcon; titulo: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-page">
        <Icon className="h-9 w-9 text-gray-300" strokeWidth={1.5} />
      </div>
      <span className="text-xs font-medium text-gray-400">{titulo}</span>
    </div>
  )
}

/** Cores por status do 4º kanban: barra lateral acentuada + tint leve (sem poluir). */
const FLUXO_TONE: Record<'transit' | 'done' | 'failed', { accent: string; bg: string; badge: 'preparing' | 'ok' | 'danger'; label: string }> = {
  transit: { accent: 'border-l-status-preparing', bg: 'bg-status-preparing/5', badge: 'preparing', label: 'Em rota' },
  done: { accent: 'border-l-status-ready', bg: 'bg-status-ready/5', badge: 'ok', label: 'Entregue' },
  failed: { accent: 'border-l-danger', bg: 'bg-danger/5', badge: 'danger', label: 'Não entregue' },
}

/**
 * Card das listas da 4ª coluna. `onConcluir` só chega para os pedidos em rota de
 * uma loja que não usa a Logística: é a única tela onde ela fecha a entrega, então
 * o botão precisa estar aqui. O corpo continua sendo um botão (abre os detalhes),
 * mas o container virou div — botão dentro de botão é HTML inválido.
 */
function FluxoCard({ order, tone, onClick, onConcluir, rotulo }: { order: Pedido; tone: 'transit' | 'done' | 'failed'; onClick: () => void; onConcluir?: () => void; rotulo?: string }) {
  const t = FLUXO_TONE[tone]
  return (
    <div className={`rounded-menuzia border border-border border-l-[3px] shadow-sm transition-shadow hover:shadow-md ${t.accent} ${t.bg}`} data-testid={`fluxo-${order.numero}`}>
      <button onClick={onClick} className="w-full p-3 text-left">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">#{order.numero}</span>
          <div className="flex items-center gap-1.5">
            {/* Em rota há dias é pedido esquecido, não entrega em andamento. */}
            {pedidoParado(order, Date.now()) && (
              <Badge tone="danger" title="Ninguém fechou este pedido. Conclua ou cancele.">
                Parado há {tempoParado(order.criadoEm, Date.now())}
              </Badge>
            )}
            <Badge tone={t.badge}>{rotulo ?? t.label}</Badge>
          </div>
        </div>
        <div className="mt-1 text-xs text-text-subtle">
          {order.clienteNome || 'Cliente'}
          {order.tipo === 'entrega' && order.enderecoBairro ? ` · ${order.enderecoBairro}` : ''}
        </div>
        <div className="mt-1 text-[11px] font-medium text-price-text">{brl(order.total)}</div>
      </button>
      {onConcluir && (
        <div className="px-3 pb-3">
          <Button variant="success" className="w-full" onClick={onConcluir}>
            Entregue
          </Button>
        </div>
      )}
    </div>
  )
}


export default function PedidosPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Recado curto depois da saída sem entregador: diz se o cliente foi avisado.
  const [avisoSaida, setAvisoSaida] = useState<{ tom: 'ok' | 'alerta'; texto: string } | null>(null)
  const [orders, setOrders] = useState<Pedido[]>([])
  // Agendados (0121) que ainda não entraram no fluxo: ficam numa faixa à parte, sem
  // alarme, sem aceite automático e sem impressão até `liberaMin` antes do horário.
  const [agendados, setAgendados] = useState<Pedido[]>([])
  const liberaMinRef = useRef(30)
  const [transit, setTransit] = useState<Pedido[]>([])
  const [concluded, setConcluded] = useState<Pedido[]>([])
  const [detail, setDetail] = useState<Pedido | null>(null)
  const [editandoPag, setEditandoPag] = useState(false)
  useEffect(() => { setEditandoPag(false) }, [detail?.id])
  const [cancelando, setCancelando] = useState<Pedido | null>(null)
  const [reimpEstado, setReimpEstado] = useState<'idle' | 'enviando' | 'ok' | 'erro'>('idle')
  const [now, setNow] = useState(() => Date.now())
  const [showCol4, setShowCol4] = useState(false)
  const [showStats, setShowStats] = useState(true)
  // Realtime e o poll de 8s podem disparar refetch() quase ao mesmo tempo; sem
  // isso, a resposta mais lenta pode resolver depois e sobrescrever o estado
  // com dados desatualizados (card sumindo, alarme disparando fora de hora).
  const refetchSeq = useRef(0)
  const alarme = useAlarmePedidos()
  const aoAtualizarAlarme = alarme.aoAtualizarPedidos
  const [autoAceitar, setAutoAceitar] = useState(false)
  const autoAceitarRef = useRef(false)
  const autoAceiteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const ordersRef = useRef<Pedido[]>([])
  const avancarRef = useRef<(p: Pedido) => void>(() => {})
  const [focusMode, setFocusMode] = useState(false)
  const [rotaOpen, setRotaOpen] = useState(false)
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const [lojaStatus, setLojaStatus] = useState<{ statusLoja: StatusLoja; horarioFuncionamento: HorarioFuncionamento | null } | null>(null)
  // Loja sem entregador fecha a entrega aqui mesmo (Ajustes › Entrega). Começa
  // no default antigo pra não mostrar botões que a loja não pediu.
  const [fluxo, setFluxo] = useState(FLUXO_LOJA_PADRAO)
  const [lojaMenuOpen, setLojaMenuOpen] = useState(false)
  const [maisAberto, setMaisAberto] = useState(false)
  // Esc fecha os menus do topo (Mais e status da loja).
  useEffect(() => {
    if (!maisAberto && !lojaMenuOpen) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMaisAberto(false); setLojaMenuOpen(false) } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [maisAberto, lojaMenuOpen])

  // restaura preferências (4º kanban e barra de métricas; o som é restaurado em use-alarme)
  useEffect(() => {
    setShowCol4(localStorage.getItem('menuzia:kanban-col4') === '1')
    setShowStats(localStorage.getItem('menuzia:kanban-stats') !== '0')
  }, [])


  // ── Aceite automático de pedidos ──────────────────────────────────────────
  /** Cancela o timer de aceite automático de um pedido (ou de todos, sem argumento). */
  const cancelarAutoAceite = useCallback((pedidoId?: string) => {
    const timers = autoAceiteTimersRef.current
    if (pedidoId) {
      const t = timers.get(pedidoId)
      if (t) {
        clearTimeout(t)
        timers.delete(pedidoId)
      }
      return
    }
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }, [])

  /**
   * Agenda o aceite automático dos pedidos "recebido" ainda sem timer.
   * O pedido fica alguns segundos tocando o alarme/piscando e então avança
   * sozinho para "Preparando" — a menos que alguém aceite/recuse antes
   * (o timer confere o status atual na hora de disparar).
   */
  const agendarAutoAceite = useCallback(
    (pedidos: Pedido[]) => {
      if (!autoAceitarRef.current) return
      const timers = autoAceiteTimersRef.current
      for (const p of pedidos) {
        if (p.status !== 'recebido' || p.preparandoNotificado || timers.has(p.id)) continue
        const timer = setTimeout(() => {
          timers.delete(p.id)
          if (!autoAceitarRef.current) return
          const atual = ordersRef.current.find((o) => o.id === p.id)
          if (atual && atual.status === 'recebido') avancarRef.current(atual)
        }, AUTO_ACEITE_DELAY_MS)
        timers.set(p.id, timer)
      }
    },
    []
  )

  function toggleStats() {
    setShowStats((v) => {
      const next = !v
      localStorage.setItem('menuzia:kanban-stats', next ? '1' : '0')
      return next
    })
  }

  function toggleSom() {
    alarme.setSomAtivo(!alarme.somAtivo)
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
      const seq = ++refetchSeq.current
      try {
        // eslint-disable-next-line prefer-const
        let [kanban, logistica, finalizados] = await Promise.all([
          listarPedidosKanban(supabase, id),
          listarPedidosLogistica(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
        ])
        // uma chamada mais nova já começou e vai vencer — descarta esta resposta
        // desatualizada em vez de deixá-la sobrescrever o estado por último.
        if (seq !== refetchSeq.current) return

        const agora = new Date()
        const esperando = kanban.filter((p) => p.status === 'recebido' && !pedidoLiberado(p.agendadoPara, liberaMinRef.current, agora))
        const idsEsperando = new Set(esperando.map((p) => p.id))
        kanban = kanban.filter((p) => !idsEsperando.has(p.id))
        setAgendados(esperando.sort((a, b) => String(a.agendadoPara).localeCompare(String(b.agendadoPara))))
        setOrders(kanban)
        setTransit(logistica.filter((p) => p.status === 'em_rota'))
        setConcluded(finalizados)


        // com o aceite automático ligado, agenda o avanço dos pedidos pendentes
        agendarAutoAceite(kanban)
      } catch {
        if (seq === refetchSeq.current) setError('Não foi possível carregar os pedidos.')
      }
    },
    [supabase, agendarAutoAceite]
  )

  // Toda mudança na lista (tempo real, poll, reconexão, aceite otimista) passa pelo alarme:
  // ele toca cada pedido "recebido" que ainda não tocou e para quando a fila zera.
  // Pedido devolvido pela cozinha (preparandoNotificado) não é "novo".
  useEffect(() => {
    ordersRef.current = orders
    aoAtualizarAlarme(orders.filter((p) => p.status === 'recebido' && !p.preparandoNotificado).map((p) => ({ id: p.id, numero: p.numero })))
  }, [orders, aoAtualizarAlarme])

  // Cleanup no unmount: timers do aceite automático (o alarme cuida de si em use-alarme).
  useEffect(() => {
    const timers = autoAceiteTimersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])

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
      // carrega o aceite automático ANTES do primeiro fetch, para os pedidos
      // pendentes já entrarem na fila de aceite se a chave estiver ligada.
      try {
        const { data: ag } = await supabase.from('restaurantes').select('agendamento_libera_min').eq('id', id).maybeSingle()
        if (typeof ag?.agendamento_libera_min === 'number') liberaMinRef.current = ag.agendamento_libera_min
      } catch {
        /* sem a coluna (antes da 0121) — fica o padrão */
      }
      try {
        const cfg = await buscarConfigImpressao(supabase, id)
        const ligado = cfg?.aceitarPedidosAutomaticamente ?? false
        autoAceitarRef.current = ligado
        setAutoAceitar(ligado)
      } catch {
        /* sem config — segue com aceite manual */
      }
      try {
        const status = await buscarStatusELoja(supabase, id)
        if (active && status) setLojaStatus(status)
      } catch {
        /* sem status — assume automático (fallback do próprio lojaEstaAberta) */
      }
      try {
        const f = await buscarFluxoLoja(supabase, id)
        if (!active) return
        setFluxo(f)
        // Sem Logística, a coluna "Entregas & concluídos" deixa de ser um extra:
        // é onde o pedido em rota vive até ser marcado como entregue. Abre por
        // padrão, mas respeita quem já escolheu explicitamente.
        if ((!f.usaLogistica || f.entregaSemEntregador) && localStorage.getItem('menuzia:kanban-col4') === null) setShowCol4(true)
      } catch {
        /* sem config — mantém o fluxo com Logística, que é como sempre foi */
      }
      if (!active) return
      await refetch(id)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [supabase, refetch])

  // Canal Realtime num effect próprio (fora da IIFE assíncrona acima): o
  // cleanup retornado por uma função async nunca é chamado pelo React — o
  // canal ficava aberto pra sempre a cada remontagem da página, vazando
  // conexões e concorrendo com o poll de 8s (ver refetchSeq acima).
  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: restauranteId ? `pedidos-kanban-${restauranteId}` : null,
    tabelas: useMemo(
      () => [{ tabela: 'pedidos', filtro: restauranteId ? `restaurante_id=eq.${restauranteId}` : undefined }],
      [restauranteId]
    ),
    aoEvento: useCallback(() => { if (restauranteId) refetch(restauranteId) }, [refetch, restauranteId]),
    aoSincronizar: useCallback(() => { if (restauranteId) refetch(restauranteId) }, [refetch, restauranteId]),
  })

  // Rede de segurança, não fonte primária: com o canal saudável basta um
  // heartbeat lento; se ele cair, o poll volta ao ritmo antigo de 8s. Um refetch
  // do Kanban custa ~30 KB num dia de pico, então manter os dois em 8s era
  // repetir de graça o que o evento já tinha trazido.
  useEffect(() => {
    if (!restauranteId) return
    const interval = setInterval(() => refetch(restauranteId), intervaloMs)
    return () => clearInterval(interval)
  }, [restauranteId, refetch, intervaloMs])

  // Internet voltou ou a aba voltou a ficar visível: busca na hora o que entrou nesse meio
  // tempo (o alarme toca o que chegou), sem esperar o poll nem o tempo real reconectar.
  useEffect(() => {
    if (!restauranteId) return
    const buscar = () => refetch(restauranteId)
    const vis = () => { if (document.visibilityState === 'visible') buscar() }
    window.addEventListener('online', buscar)
    document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('online', buscar); document.removeEventListener('visibilitychange', vis) }
  }, [restauranteId, refetch])

  // relógio para os tempos decorridos (ticando a cada segundo)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const lojaAberta = useMemo(() => (lojaStatus ? lojaEstaAberta(lojaStatus) : true), [lojaStatus, now])

  async function mudarStatusLoja(status: StatusLoja) {
    if (!restauranteId) return
    setLojaMenuOpen(false)
    const anterior = lojaStatus
    setLojaStatus((prev) => (prev ? { ...prev, statusLoja: status } : prev))
    try {
      await definirStatusLoja(supabase, restauranteId, status)
    } catch {
      setLojaStatus(anterior)
      setError('Não foi possível atualizar o status da loja.')
    }
  }

  function colunaDe(p: Pedido): Coluna | null {
    if (p.status === 'recebido') return 'recebido'
    if (p.status === 'preparando') return 'preparando'
    if (p.status === 'pronto') return 'pronto'
    return null
  }

  /**
   * Move o pedido para `novo`. `avancar` usa o passo natural do card; a ação
   * "Entregue" do pedido pronto pula o "em rota" (loja que entrega na hora, sem
   * rota nenhuma pra registrar).
   */
  async function moverPara(p: Pedido, novo: StatusPedido | null) {
    if (!novo || !restauranteId) return
    cancelarAutoAceite(p.id)

    // Otimista. `entregue` e `em_rota` tiram o pedido das três colunas do
    // Kanban, então ele precisa aparecer na lista certa da 4ª coluna na mesma
    // hora — senão some da tela até o próximo refetch.
    setOrders((prev) => (novo === 'entregue' || novo === 'em_rota' ? prev.filter((o) => o.id !== p.id) : prev.map((o) => (o.id === p.id ? { ...o, status: novo } : o))))
    if (novo === 'em_rota') {
      setTransit((prev) => (prev.some((o) => o.id === p.id) ? prev : [...prev, { ...p, status: 'em_rota' }]))
    }
    if (novo === 'entregue') {
      setTransit((prev) => prev.filter((o) => o.id !== p.id))
      setConcluded((prev) => (prev.some((o) => o.id === p.id) ? prev : [{ ...p, status: 'entregue' }, ...prev]))
    }
    try {
      // Compare-and-set com o status que o card mostrava: aba velha perde para quem
      // mexeu antes, cai no catch e o refetch devolve o card ao estado real.
      if (novo === 'entregue') await marcarPedidoEntregue(supabase, p.id, p.status)
      else await avancarStatusPedido(supabase, p.id, novo, p.status)
      notificarPedido(p.id, novo)
    } catch {
      setError('Não foi possível atualizar o pedido.')
      refetch(restauranteId)
    }
  }

  /**
   * Entrega sem entregador: um toque avisa o cliente ("saiu para entrega") e
   * conclui o pedido, tudo no servidor (/api/admin/pedidos/[id]/saiu-entrega).
   * Não passa por moverPara: lá o cliente receberia também a mensagem de
   * "entregue", que ninguém confirmou.
   */
  async function saiuSemEntregador(p: Pedido) {
    if (!restauranteId) return
    cancelarAutoAceite(p.id)
    setOrders((prev) => prev.filter((o) => o.id !== p.id))
    setConcluded((prev) => (prev.some((o) => o.id === p.id) ? prev : [{ ...p, status: 'entregue' }, ...prev]))
    try {
      const res = await fetch(`/api/admin/pedidos/${p.id}/saiu-entrega`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { error?: string; mensagem?: string; concluido?: boolean }
      if (!res.ok) throw new Error(data.error ?? 'Não foi possível registrar a saída.')
      const avisado = data.mensagem === 'enviada'
      setAvisoSaida({
        tom: avisado ? 'ok' : 'alerta',
        texto: avisado
          ? `Pedido #${p.numero} saiu para entrega — cliente avisado no WhatsApp.`
          : data.mensagem === 'sem_whatsapp'
            ? `Pedido #${p.numero} saiu para entrega. O WhatsApp da loja não está conectado, então o cliente não foi avisado.`
            : `Pedido #${p.numero} saiu para entrega, mas o aviso ao cliente não saiu (telefone inválido ou WhatsApp fora do ar).`,
      })
      if (!data.concluido) refetch(restauranteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a saída.')
      refetch(restauranteId)
    }
  }

  // O recado some sozinho; um novo substitui o anterior.
  useEffect(() => {
    if (!avisoSaida) return
    const t = setTimeout(() => setAvisoSaida(null), 6000)
    return () => clearTimeout(t)
  }, [avisoSaida])

  async function avancar(p: Pedido) {
    // Sem motoboy, a entrega termina em "Saiu p/ entrega" (servidor avisa e conclui).
    if (p.status === 'pronto' && p.tipo === 'entrega' && !usaDespachoDeRotas(fluxo)) return saiuSemEntregador(p)
    await moverPara(p, proximoStatusKanban(p.status, p.tipo, fluxo.usaLogistica))
  }

  // Mantém a ref apontando pro avancar mais recente — os timers de aceite
  // automático chamam via ref para não prender um closure com estado velho.
  useEffect(() => {
    avancarRef.current = avancar
  })

  /** Liga/desliga o aceite automático — mesma chave da página Impressão. */
  async function toggleAutoAceite() {
    if (!restauranteId) return
    const next = !autoAceitar
    setAutoAceitar(next)
    autoAceitarRef.current = next
    if (next) agendarAutoAceite(ordersRef.current)
    else cancelarAutoAceite()
    try {
      await atualizarConfigImpressao(supabase, restauranteId, { aceitarPedidosAutomaticamente: next })
    } catch {
      const volta = !next
      setAutoAceitar(volta)
      autoAceitarRef.current = volta
      if (!volta) cancelarAutoAceite()
      setError('Não foi possível salvar o aceite automático de pedidos.')
    }
  }

  // Zera o feedback de reimpressão ao abrir/trocar de pedido no drawer.
  useEffect(() => setReimpEstado('idle'), [detail?.id])

  async function reimprimir(p: Pedido) {
    setReimpEstado('enviando')
    try {
      await solicitarReimpressao(supabase, p.id)
      setReimpEstado('ok')
    } catch {
      setReimpEstado('erro')
    }
  }

  /** Abre o modal de motivo. Pausa o aceite automático para o pedido não avançar sozinho. */
  function pedirCancelamento(p: Pedido) {
    cancelarAutoAceite(p.id)
    setCancelando(p)
  }

  /** Chamado depois que o servidor confirmou o cancelamento. */
  function aoCancelar(pedidoId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== pedidoId))
    setCancelando(null)
    setDetail(null)
    notificarPedido(pedidoId, 'cancelado')
    if (restauranteId) refetch(restauranteId)
  }

  const abertos = orders.length
  const emEntrega = transit.length
  // Pedido que ninguém fechou continua aqui para sempre (o #95 ficou em rota desde
  // julho). Nada se fecha sozinho — mas a tela cobra, senão ninguém vê (lib/pedido-parado.ts).
  const tempoMedioMin = orders.length
    ? Math.round(orders.reduce((s, o) => s + tempoDecorrido(o.criadoEm, now).mins, 0) / orders.length)
    : 0
  const faturamentoTurno =
    orders.reduce((s, o) => s + o.total, 0) +
    concluded.filter((o) => o.status === 'entregue').reduce((s, o) => s + o.total, 0)

  // ── Barra do topo (2026-10-03) ──────────────────────────────────────────────
  // Controles logo depois do título (esquerda), separados dos botões do sistema (direita).
  // 44 px, ícone + texto, estado ligado/desligado visível e no tooltip. Abaixo de xl, os menos
  // usados (Métricas, Entregas, Tela cheia) vão para "Mais ⋯".
  const parados = [...orders, ...transit].filter((p) => pedidoParado(p, now))
  const avisos: Aviso[] = parados.length
    ? [{
        id: 'parados',
        titulo: parados.length === 1 ? '1 pedido aberto há mais de 12 horas' : `${parados.length} pedidos abertos há mais de 12 horas`,
        texto: 'Marque como entregue, não entregue ou cancele. Enquanto isso, contam como pendentes na taxa de conclusão.',
        pedidos: parados.map((p) => ({ id: p.id, numero: p.numero, cliente: p.clienteNome, status: p.status, aberto: tempoParado(p.criadoEm, now) })),
      }]
    : []
  const acharPedido = (id: string) => [...orders, ...transit].find((o) => o.id === id)
  /** "Ver no kanban": abre a coluna certa, rola até o card e pisca a borda. */
  function verNoKanban(id: string) {
    const p = acharPedido(id)
    if (!p) return
    if (p.status === 'em_rota' && !showCol4) toggleCol4()
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="pedido-${p.numero}"], [data-testid="fluxo-${p.numero}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
      el.setAttribute('data-destaque', '1')
      el.animate?.([{ boxShadow: '0 0 0 0 rgba(245,158,11,0)' }, { boxShadow: '0 0 0 4px rgba(245,158,11,0.9)' }, { boxShadow: '0 0 0 0 rgba(245,158,11,0)' }], { duration: 900, iterations: 3 })
      setTimeout(() => el.removeAttribute('data-destaque'), 3000)
    }, 150)
  }
  async function avisoNaoEntregue(id: string) {
    try {
      await cancelarPedidoRequest(id, 'nao_entregue', 'Pedido aberto há mais de 12 horas — marcado como não entregue no aviso do painel.')
      setOrders((prev) => prev.filter((o) => o.id !== id))
      setTransit((prev) => prev.filter((o) => o.id !== id))
      if (restauranteId) refetch(restauranteId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível marcar como não entregue.')
    }
  }

  const BTN = 'inline-flex h-[44px] flex-shrink-0 items-center gap-2 rounded-[3px] border px-3 text-[13px] font-semibold transition-colors'
  const estadoChip = (ligado: boolean) => (
    <span className={`rounded-full px-1.5 py-[1px] text-[10.5px] font-bold ${ligado ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#F3F4F6] text-[#6B7280]'}`}>{ligado ? 'Ligado' : 'Desligado'}</span>
  )
  const statusTexto = lojaStatus && lojaStatus.statusLoja !== 'automatico' ? 'Manual' : 'Automático'
  const controles = (
    <>
      <div className="relative">
        <button
          onClick={() => setLojaMenuOpen((v) => !v)}
          title={`${lojaAberta ? 'Recebendo pedidos' : 'Loja fechada'} (${statusTexto}). Clique para abrir ou fechar a loja manualmente.`}
          className={`${BTN} ${lojaAberta ? 'border-[#86EFAC] bg-price-bg text-price-text hover:brightness-95' : 'border-[#FCA5A5] bg-danger-bg text-danger hover:brightness-95'}`}
          data-testid="kanban-status-loja"
        >
          <span className="relative flex h-2.5 w-2.5">
            {lojaAberta && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-price-text opacity-60" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${lojaAberta ? 'bg-price-text' : 'bg-danger'}`} />
          </span>
          {lojaAberta ? 'Recebendo pedidos' : 'Loja fechada'}
          <span className="rounded-full bg-white/70 px-1.5 py-[1px] text-[10.5px] font-bold">{statusTexto}</span>
          <ChevronDown className="h-4 w-4 opacity-70" />
        </button>
        {lojaMenuOpen && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" onClick={() => setLojaMenuOpen(false)} aria-label="Fechar menu" />
            <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-menuzia border border-border bg-white py-1.5 shadow-lg">
              <button onClick={() => mudarStatusLoja('aberto_manual')} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-main hover:bg-page">
                <span className="h-2 w-2 rounded-full bg-price-text" /> Forçar aberta agora
              </button>
              <button onClick={() => mudarStatusLoja('fechado_manual')} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-main hover:bg-page">
                <span className="h-2 w-2 rounded-full bg-danger" /> Fechar agora
              </button>
              <button onClick={() => mudarStatusLoja('automatico')} className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[13px] font-medium text-text-main hover:bg-page">
                <span className="h-2 w-2 rounded-full bg-text-subtle" /> Voltar ao automático (grade de horário)
              </button>
              <p className="px-3 pt-1.5 text-[11px] leading-tight text-text-subtle">
                Grade de horário semanal se configura em Ajustes. Forçar aberta/fechada aqui vale até você reverter.
              </p>
            </div>
          </>
        )}
      </div>
      {alarme.tocando ? (
        <button onClick={alarme.silenciar} title="Alarme de pedido novo tocando. Clique para silenciar (o próximo pedido novo toca de novo)." className={`${BTN} border-status-pending bg-status-pending text-white hover:brightness-95`} data-testid="kanban-silenciar">
          <BellRing className="h-[18px] w-[18px] animate-pulse" /> Silenciar
        </button>
      ) : (
        <button
          onClick={toggleSom}
          aria-pressed={alarme.somAtivo}
          title={alarme.somAtivo ? 'Som de pedido novo: LIGADO. Toca a cada pedido novo e repete até alguém aceitar. Clique para desligar.' : 'Som de pedido novo: DESLIGADO. Clique para ligar.'}
          className={`${BTN} ${alarme.somAtivo ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border bg-white text-text-subtle hover:bg-page'}`}
          data-testid="kanban-som"
        >
          {alarme.somAtivo ? <BellRing className="h-[18px] w-[18px]" /> : <BellOff className="h-[18px] w-[18px]" />} Som {estadoChip(alarme.somAtivo)}
        </button>
      )}
      <button
        onClick={toggleAutoAceite}
        aria-pressed={autoAceitar}
        title={autoAceitar
          ? 'Aceite automático: LIGADO. Pedido novo toca o alarme por alguns segundos e vai sozinho para Preparando. Clique para desligar.'
          : 'Aceite automático: DESLIGADO. Pedidos novos esperam alguém aceitar. Clique para ligar.'}
        className={`${BTN} ${autoAceitar ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#15803D] hover:brightness-95' : 'border-border bg-white text-text-subtle hover:bg-page'}`}
        data-testid="kanban-aceite"
      >
        <Zap className="h-[18px] w-[18px]" /> Aceite auto {estadoChip(autoAceitar)}
      </button>
      {usaDespachoDeRotas(fluxo) ? (
        <button onClick={() => setRotaOpen(true)} title="Despacho de rotas: monte as rotas dos motoboys no mapa." className={`${BTN} max-2xl:hidden border-border bg-white text-text-main hover:border-status-pending hover:text-status-pending`} data-testid="kanban-rotas">
          <Bike className="h-[18px] w-[18px]" /> Rotas
        </button>
      ) : (
        <span title="Rotas desligado: esta loja não trabalha com motoboy (Ajustes › Entrega). A entrega é concluída aqui no Kanban." className="inline-flex max-2xl:hidden" data-testid="kanban-rotas-desligado">
          <button disabled data-rotas-desligado className={`${BTN} pointer-events-none cursor-not-allowed border-border bg-page text-text-subtle opacity-60`}>
            <Bike className="h-[18px] w-[18px]" /> Rotas
          </button>
        </span>
      )}
      <button onClick={toggleStats} aria-pressed={showStats} title={showStats ? 'Métricas: VISÍVEIS (pedidos abertos, tempo médio, em entrega, faturamento). Clique para ocultar.' : 'Métricas: OCULTAS. Clique para mostrar.'}
        className={`${BTN} max-[1799px]:hidden ${showStats ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-white text-text-subtle hover:bg-page'}`} data-testid="kanban-metricas">
        {showStats ? <Eye className="h-[18px] w-[18px]" /> : <EyeOff className="h-[18px] w-[18px]" />} Métricas {estadoChip(showStats)}
      </button>
      <button onClick={toggleCol4} aria-pressed={showCol4} title={showCol4 ? 'Coluna de entregas e concluídos: VISÍVEL. Clique para ocultar.' : 'Coluna de entregas e concluídos: OCULTA. Clique para mostrar.'}
        className={`${BTN} max-[1799px]:hidden ${showCol4 ? 'border-[#D8B4FE] bg-[#FAF5FF] text-purple' : 'border-border bg-white text-text-subtle hover:bg-page'}`} data-testid="kanban-entregas">
        <Columns3 className="h-[18px] w-[18px]" /> Entregas
      </button>
      <button onClick={toggleFocus} title={focusMode ? 'Sair da tela cheia' : 'Tela cheia: esconde o menu lateral e ocupa a tela toda'}
        className={`${BTN} max-[1799px]:hidden ${focusMode ? 'border-text-main bg-text-main text-white' : 'border-border bg-white text-text-subtle hover:bg-page'}`} data-testid="kanban-tela-cheia">
        {focusMode ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />} {focusMode ? 'Sair da tela cheia' : 'Tela cheia'}
      </button>
      <div className="relative">
        <button onClick={() => setMaisAberto((v) => !v)} aria-expanded={maisAberto} title="Mais opções: testar som, repetição do alarme, notificações" className={`${BTN} border-border bg-white text-text-main hover:bg-page`} data-testid="kanban-mais">
          <MoreHorizontal className="h-[18px] w-[18px]" /> Mais
        </button>
        {maisAberto && (
          <>
            <button className="fixed inset-0 z-40 cursor-default" onClick={() => setMaisAberto(false)} aria-label="Fechar menu" />
            <div className="absolute left-0 top-full z-50 mt-1.5 w-[min(288px,calc(100vw-24px))] sm:left-auto sm:right-0 rounded-menuzia border border-border bg-white py-1.5 shadow-lg" data-testid="kanban-mais-menu">
              <button onClick={() => { void alarme.testar(); setMaisAberto(false) }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-page" data-testid="kanban-testar-som">
                <Volume2 className="h-4 w-4" /> Testar som
              </button>
              <div className="border-t border-border px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Repetir o alarme</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {OPCOES_REPETICAO.map((s) => (
                    <button key={s} onClick={() => alarme.setRepetirSeg(s)} aria-pressed={alarme.repetirSeg === s}
                      className={`h-[32px] rounded-[3px] border px-2 text-[12px] font-semibold ${alarme.repetirSeg === s ? 'border-primary bg-primary text-white' : 'border-border bg-white text-text-main hover:bg-page'}`} data-testid={`kanban-repetir-${s}`}>
                      {s === 0 ? 'Não repetir' : `${s} s`}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-text-subtle">Repete enquanto houver pedido novo sem aceitar.</p>
              </div>
              {alarme.permissaoNotif !== 'sem_suporte' && (
                <button onClick={() => void alarme.pedirNotificacao()} disabled={alarme.permissaoNotif === 'granted'}
                  className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-[13px] font-medium hover:bg-page disabled:cursor-default disabled:hover:bg-white" data-testid="kanban-notificacoes">
                  <Bell className="h-4 w-4" />
                  {alarme.permissaoNotif === 'granted' ? 'Notificações do navegador: ligadas' : alarme.permissaoNotif === 'denied' ? 'Notificações bloqueadas no navegador (libere no cadeado)' : 'Ligar notificações com a aba escondida'}
                </button>
              )}
              <div className="border-t border-border min-[1800px]:hidden">
                {usaDespachoDeRotas(fluxo) ? (
                  <button onClick={() => { setRotaOpen(true); setMaisAberto(false) }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-page 2xl:hidden">
                    <Bike className="h-4 w-4" /> Rotas (despacho)
                  </button>
                ) : (
                  <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-subtle 2xl:hidden" title="Esta loja não trabalha com motoboy (Ajustes › Entrega)."><Bike className="h-4 w-4" /> Rotas: desligado (sem motoboy)</p>
                )}
                <button onClick={() => { toggleStats(); setMaisAberto(false) }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-page">
                  {showStats ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {showStats ? 'Ocultar métricas' : 'Mostrar métricas'}
                </button>
                <button onClick={() => { toggleCol4(); setMaisAberto(false) }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-page">
                  <Columns3 className="h-4 w-4" /> {showCol4 ? 'Ocultar entregas e concluídos' : 'Mostrar entregas e concluídos'}
                </button>
                <button onClick={() => { void toggleFocus(); setMaisAberto(false) }} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium hover:bg-page max-lg:hidden">
                  {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {focusMode ? 'Sair da tela cheia' : 'Tela cheia'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
  const avisosTopo = (
    <AvisosPedidos
      avisos={avisos}
      onEntregue={async (id) => { const p = acharPedido(id); if (p) await moverPara(p, 'entregue') }}
      onNaoEntregue={avisoNaoEntregue}
      onCancelar={(id) => { const p = acharPedido(id); if (p) pedirCancelamento(p) }}
      onVer={verNoKanban}
    />
  )
  const topBar = <TopBar title="Painel de Pedidos" breadcrumb="Pedidos › Kanban" controles={controles} right={avisosTopo} />

  if (loading) {
    return (
      <>
        {topBar}
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando pedidos…</div>
      </>
    )
  }

  return (
    <>
      {topBar}

      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-5">
        {error && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}
        {avisoSaida && (
          <div
            role="status"
            className={`rounded-menuzia border px-3.5 py-2.5 text-[13px] font-medium ${
              avisoSaida.tom === 'ok' ? 'border-[#86efac] bg-[#f0fdf4] text-[#15803d]' : 'border-[#fcd34d] bg-warn-bg text-[var(--adm-laranja)]'
            }`}
          >
            {avisoSaida.texto}
          </div>
        )}

        {alarme.somAtivo && alarme.bloqueado && (
          <button
            type="button"
            onClick={() => void alarme.testar()}
            className="flex w-full items-center justify-center gap-2 rounded-menuzia border border-[#FCD34D] bg-warn-bg px-3.5 py-2.5 text-[14px] font-bold text-[#B45309] hover:brightness-95"
            data-testid="som-bloqueado"
          >
            {TEXTO_SOM_BLOQUEADO}
          </button>
        )}

        {/* Stats — barra de métricas acima dos kanbans (oculta em tela cheia ou pelo botão Métricas) */}
        {!focusMode && showStats && (
          // Mesmo cartão da tela Clientes (components/admin/cartao-numero.tsx).
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="cards-resumo-pedidos">
            <CartaoNumero icone={ICONES.pedidos} tom="laranja" rotulo="Pedidos abertos" valor={abertos} />
            <CartaoNumero icone={ICONES.cronometro} tom="azul" rotulo="Tempo médio" valor={`${tempoMedioMin} min`} />
            <CartaoNumero icone={ICONES.moto} tom="roxo" rotulo="Em entrega" valor={emEntrega} />
            <CartaoNumero icone={ICONES.dinheiro} tom="verde" rotulo="Faturamento do turno" valor={<span className="text-price-text">{brl(faturamentoTurno)}</span>} />
          </div>
        )}

        {agendados.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto rounded-menuzia border border-border bg-white px-3 py-2" data-testid="faixa-agendados">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-text-subtle">Agendados ({agendados.length})</span>
            {agendados.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetail(p)}
                className="shrink-0 rounded-menuzia border border-border bg-page px-2.5 py-1 text-[12px] text-text-main hover:border-primary"
                title="Entra no painel, na cozinha e na impressão perto do horário"
              >
                <strong>#{p.numero}</strong> · {textoAgendado(p.agendadoPara!)} · {p.clienteNome}
              </button>
            ))}
          </div>
        )}

        {/* Board */}
        <div className={`grid flex-1 grid-cols-1 gap-3 overflow-hidden max-lg:flex max-lg:flex-col max-lg:overflow-y-auto ${showCol4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          {(['recebido', 'preparando', 'pronto'] as Coluna[]).map((coluna) => {
            const colOrders = orders.filter((o) => colunaDe(o) === coluna)
            const cfg = COLUNA_CONFIG[coluna]
            const accent: Record<Coluna, string> = { recebido: 'border-l-status-pending', preparando: 'border-l-[#024A7D]', pronto: 'border-l-status-ready' }
            return (
              <div key={coluna} className="flex flex-col overflow-hidden rounded-menuzia border border-border bg-white max-lg:flex-shrink-0 max-lg:overflow-visible">
                <div className={`flex items-center justify-between px-4 py-3 text-white ${cfg.headerBg}`}>
                  <div className="flex items-center gap-2">
                    <cfg.Icon className="h-4 w-4" strokeWidth={2.5} />
                    <h3 className="text-sm font-bold">{cfg.label}</h3>
                  </div>
                  <span className="rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-bold text-white">{colOrders.length}</span>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-3 max-lg:overflow-visible">
                  {colOrders.map((order) => {
                    const tempo = tempoDecorrido(order.criadoEm, now)
                    return (
                      <div
                        key={order.id}
                        data-testid={`pedido-${order.numero}`}
                        className={[
                          'rounded-menuzia border border-border border-l-[4px] bg-white p-3.5 shadow-md transition-shadow hover:shadow-lg',
                          accent[coluna],
                          order.status === 'recebido' && !order.preparandoNotificado ? 'animate-new-order' : '',
                        ].join(' ')}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="rounded-menuzia bg-text-main px-1.5 py-0.5 text-sm font-bold text-white">#{order.numero}</span>
                            {order.status === 'recebido' && <Badge tone="new">Novo</Badge>}
                            {/* Aberto há mais de 12h: o cronômetro em minutos não dá conta
                                de mostrar isso (um pedido de julho marca "97000:12"). */}
                            {pedidoParado(order, now) && (
                              <Badge tone="danger" title="Ninguém fechou este pedido. Conclua ou cancele.">
                                Parado há {tempoParado(order.criadoEm, now)}
                              </Badge>
                            )}
                            {/* Salão e balcão não são a mesma coisa: quem lê o card precisa
                                saber se o prato vai para uma mesa ou para o balcão. */}
                            {origemDoCard(order).posto === 'Salão' && <Badge tone="ready">Salão</Badge>}
                            {origemDoCard(order).posto === 'PDV' && <Badge tone="alert">PDV</Badge>}
                            {origemDoCard(order).posto === 'Delivery' && <Badge tone="paused">Delivery</Badge>}
                            {order.agendadoPara && <Badge tone="alert">Agendado {textoAgendado(order.agendadoPara)}</Badge>}
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-menuzia px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${timerTone(tempo.mins)}`}
                              title="Tempo desde que o pedido chegou"
                            >
                              <Clock className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                              {tempo.label}
                            </span>
                            <EtiquetaAtendimento atendimento={etiquetasDoPedido(order).atendimento} compacta />
                          </div>
                        </div>
                        <div className="mb-2 min-w-0">
                          {/* Nome (ou mesa) à esquerda e preço à direita, na MESMA linha. Origem e
                              atendimento já estão nas etiquetas de cima; senha, comanda e quem lançou
                              ficam nos Detalhes. O nome trunca, o preço nunca quebra. */}
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="min-w-0 truncate text-[13px] font-semibold" title={order.clienteNome || undefined}>{order.clienteNome || 'Cliente'}</span>
                              {/* PDV identificado (0094): telefone discreto; endereço fica no detalhe. */}
                              {order.origem === 'pdv' && order.clienteTelefone && (
                                <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-subtle">{mascararTelefoneBR(order.clienteTelefone)}</span>
                              )}
                            </div>
                            <div className="flex-shrink-0 whitespace-nowrap rounded-menuzia bg-price-bg px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-price-text" data-testid="card-preco">
                              {brl(order.total)}
                            </div>
                          </div>
                          {order.tipo === 'entrega' && order.enderecoBairro && (
                            <div className="mt-0.5 truncate text-xs text-text-subtle">{order.enderecoBairro}</div>
                          )}
                          <ul className="mt-1 space-y-0.5 text-xs text-text-subtle">
                            {resumoItens(order).map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                          <div className="mt-1.5"><InfoPagamento p={order} compacto /></div>
                          {order.status === 'preparando' && order.preparandoPor && (
                            <div className="mt-1 text-[11px] text-text-subtle">Em preparo por: {order.preparandoPor}</div>
                          )}
                          {order.preparadoPor && (
                            <div className="mt-1 text-[11px] text-text-subtle">Preparado por: {order.preparadoPor}</div>
                          )}
                        </div>
                        <div className="flex gap-2 [&>*]:whitespace-nowrap">
                          <Button variant="secondary" className="flex-[0.7] px-2" onClick={() => setDetail(order)} data-testid="card-detalhes">
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
                                onClick={() => pedirCancelamento(order)}
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
                          {order.status === 'pronto' && order.tipo === 'entrega' && !usaDespachoDeRotas(fluxo) && (
                            <Button
                              variant="dispatch"
                              className="flex-1"
                              onClick={() => saiuSemEntregador(order)}
                              title="Avisa o cliente no WhatsApp e conclui o pedido"
                            >
                              Saiu p/ entrega
                            </Button>
                          )}
                          {order.status === 'pronto' && order.tipo === 'entrega' && usaDespachoDeRotas(fluxo) && (
                            <span
                              className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-menuzia border border-[#0369A1]/25 bg-alert-bg px-2 text-[11px] font-bold uppercase tracking-wide text-alert-text lg:min-h-0"
                              data-testid="card-na-logistica"
                              title="Despacho feito no módulo de Logística"
                            >
                              <Capacete className="h-3.5 w-3.5" strokeWidth={2.2} />
                              Na logística
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {colOrders.length === 0 && <ColunaVazia Icon={cfg.EmptyIcon} titulo={cfg.emptyTitle} />}
                </div>
              </div>
            )
          })}

          {/* 4ª coluna opcional: entregas e concluídos */}
          {showCol4 && (
            <div className="flex flex-col overflow-hidden rounded-menuzia border border-border border-t-[3px] border-t-purple bg-white max-lg:flex-shrink-0 max-lg:overflow-visible">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Entregas & concluídos</h3>
                <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-bold text-text-subtle">{transit.length + concluded.length}</span>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-3 max-lg:overflow-visible">
                <SubSecao titulo="Em trânsito" cor="text-status-preparing" vazio="Ninguém em rota">
                  {transit.map((o) => (
                    <FluxoCard
                      key={o.id}
                      order={o}
                      tone="transit"
                      onClick={() => setDetail(o)}
                      onConcluir={fluxo.usaLogistica ? undefined : () => moverPara(o, 'entregue')}
                    />
                  ))}
                </SubSecao>
                <SubSecao titulo="Concluídos" cor="text-price-text" vazio="Nada concluído hoje">
                  {concluded.filter((o) => o.status === 'entregue').map((o) => (
                    <FluxoCard
                      key={o.id}
                      order={o}
                      tone="done"
                      onClick={() => setDetail(o)}
                      // Loja sem motoboy fecha na saída: ninguém confirmou que chegou.
                      rotulo={!usaDespachoDeRotas(fluxo) && o.tipo === 'entrega' ? 'Saiu p/ entrega' : undefined}
                    />
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
      {rotaOpen && restauranteId && usaDespachoDeRotas(fluxo) && (
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
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-4.5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="whitespace-nowrap text-[15px] font-bold">Pedido #{detail.numero}</h2>
                <p className="mt-0.5 truncate text-xs text-text-subtle" title={detail.clienteNome || undefined}>{detail.clienteNome || 'Cliente'}</p>
              </div>
              {/* Origem, atendimento e mesa no canto — o mesmo vocabulário do card. No
                  celular descem para a linha de baixo, ainda à direita, sem espremer o título. */}
              <div className="max-sm:order-3 max-sm:w-full sm:flex-shrink-0">
                <EtiquetasPedido pedido={detail} />
                {detail.agendadoPara && <p className="mt-1 text-right text-[12px] font-semibold text-alert-text" data-testid="detalhe-agendado">Agendado para {textoAgendado(detail.agendadoPara)}</p>}
              </div>
              <button onClick={() => setDetail(null)} aria-label="Fechar detalhes" className="toque-icone flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4.5">
              {detail.status === 'cancelado' && (
                <div className="mb-5 rounded-menuzia border border-danger bg-danger-bg p-3 text-sm">
                  <div className="font-semibold text-danger">Pedido cancelado · {rotuloMotivo(detail.canceladoMotivo)}</div>
                  {detail.canceladoObservacao && <div className="mt-1 text-text-main">{detail.canceladoObservacao}</div>}
                  {detail.canceladoPor && <div className="mt-1 text-xs text-text-subtle">por {detail.canceladoPor}</div>}
                </div>
              )}

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
                    {linha.observacao && <div className="mt-1 text-[13px] font-bold uppercase text-danger">obs: {linha.observacao}</div>}
                  </li>
                ))}
                <li className="flex justify-between border-t border-border pt-2 text-text-subtle"><span>Subtotal</span><span>{brl(detail.subtotal)}</span></li>
                {detail.desconto > 0 && (
                  <li className="flex justify-between text-text-subtle"><span>Desconto</span><span className="text-price-text">-{brl(detail.desconto)}</span></li>
                )}
                {detail.taxaEntrega > 0 && (
                  <li className="flex justify-between text-text-subtle"><span>Taxa de entrega</span><span>{brl(detail.taxaEntrega)}</span></li>
                )}
                <li className="flex justify-between font-bold"><span>Total</span><span className="text-price-text">{brl(detail.total)}</span></li>
              </ul>

              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cliente & pagamento</div>
              <div className="mb-5 space-y-1.5 rounded-menuzia border border-border p-3 text-sm">
                <div className="flex justify-between"><span className="text-text-subtle">Cliente</span><span className="font-medium">{detail.clienteNome || '—'}</span></div>
                {/* Senha do balcão / comanda da mesa e quem lançou (saiu do corpo do card). */}
                {referenciaDoLancamento(detail) && (
                  <div className="flex justify-between gap-3" data-testid="detalhes-lancamento">
                    <span className="flex-shrink-0 text-text-subtle">Lançamento</span>
                    <span className="text-right font-medium">{referenciaDoLancamento(detail)}</span>
                  </div>
                )}
                {detail.clienteTelefone && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-text-subtle">Telefone</span>
                    <span className="flex items-center gap-1.5 font-medium">
                      {mascararTelefoneBR(detail.clienteTelefone)}
                      {!detail.telefoneVerificado && detail.origem !== 'pdv' && <Badge tone="danger" title="Telefone não confirmado por WhatsApp">não verif.</Badge>}
                    </span>
                  </div>
                )}
                {detail.canal === 'mesa' ? (
                  <div className="flex items-center justify-between"><span className="text-text-subtle">Pagamento</span><span className="font-medium">No fechamento da conta</span></div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2" data-testid="detalhes-pagamento"><span className="text-text-subtle">Pagamento</span><InfoPagamento p={detail} /></div>
                    <AlertaTroco p={detail} />
                    {detail.status !== 'cancelado' && (editandoPag
                      ? <EditorPagamento pedidoId={detail.id} p={detail} onCancelar={() => setEditandoPag(false)} onFeito={() => { setEditandoPag(false); setDetail(null) }} />
                      : <button type="button" onClick={() => setEditandoPag(true)} data-testid="detalhes-alterar-pagamento" className="text-[12px] font-semibold text-primary underline">Alterar pagamento</button>)}
                  </>
                )}
                {detail.status === 'preparando' && detail.preparandoPor && (
                  <div className="flex justify-between"><span className="text-text-subtle">Em preparo por</span><span className="font-medium">{detail.preparandoPor}</span></div>
                )}
                {detail.preparadoPor && (
                  <div className="flex justify-between"><span className="text-text-subtle">Preparado por</span><span className="font-medium">{detail.preparadoPor}</span></div>
                )}
              </div>

              {detail.tipo === 'entrega' && (
                <>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Endereço de entrega</div>
                  <div className="rounded-menuzia border border-border p-3 text-sm text-text-main">
                    <span className="font-semibold">{detail.enderecoRua}, {detail.enderecoNumero}</span>
                    {detail.enderecoComplemento && ` · ${detail.enderecoComplemento}`}
                    <div className="text-text-subtle">
                      <span className="font-semibold text-text-main">{detail.enderecoBairro}</span>
                      {detail.enderecoCidade && ` · ${detail.enderecoCidade}`}
                      {detail.enderecoCep && ` · ${detail.enderecoCep}`}
                    </div>
                    {detail.enderecoReferencia && (
                      <div className="mt-1.5 text-text-subtle">Referência: <span className="font-medium text-text-main">{detail.enderecoReferencia}</span></div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-border p-4.5">
              <button
                onClick={() => reimprimir(detail)}
                disabled={reimpEstado === 'enviando' || reimpEstado === 'ok'}
                className="flex w-full items-center justify-center gap-2 rounded-menuzia bg-text-main px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-black disabled:opacity-60"
              >
                <PrinterCheck className="h-4 w-4" />
                {reimpEstado === 'enviando' ? 'Enviando…' : reimpEstado === 'ok' ? 'Enviado p/ impressora' : 'Reimprimir pedido'}
              </button>
              {reimpEstado === 'ok' && (
                <p className="mt-2 text-center text-[11px] text-text-subtle">Sai na próxima varredura do Assistente (impressão automática precisa estar ligada).</p>
              )}
              {reimpEstado === 'erro' && (
                <p className="mt-2 text-center text-[11px] text-danger">Não foi possível solicitar a reimpressão. Tente de novo.</p>
              )}
              {/* Escape para quem usa a Logística no dia a dia mas entregou este
                  pedido na mão (o dono levou, o cliente passou pra buscar). Sem
                  isso o pedido fica preso esperando um entregador que não existe. */}
              {fluxo.usaLogistica && !fluxo.entregaSemEntregador && detail.tipo === 'entrega' && (detail.status === 'pronto' || detail.status === 'em_rota') && (
                <button
                  onClick={() => { const p = detail; setDetail(null); moverPara(p, 'entregue') }}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-menuzia border border-status-ready px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-status-ready transition-colors hover:bg-status-ready/10"
                >
                  <span aria-hidden>✓</span>
                  Concluir sem entregador
                </button>
              )}
              {podeCancelar(detail.status) && (
                <button
                  onClick={() => pedirCancelamento(detail)}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-menuzia border border-danger px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-danger transition-colors hover:bg-danger-bg"
                >
                  <span aria-hidden>✕</span>
                  Cancelar pedido
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      {cancelando && (
        <CancelarPedidoModal
          pedido={cancelando}
          onFechar={() => setCancelando(null)}
          onCancelado={aoCancelar}
        />
      )}
    </>
  )
}
