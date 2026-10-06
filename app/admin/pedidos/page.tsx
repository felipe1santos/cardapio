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
  Columns3,
  Maximize2,
  Minimize2,
  Inbox,
  ChefHat,
  HandPlatter,
  Clock,
  Eye,
  EyeOff,
  Zap,
  ZapOff,
  ArrowRight,
  Banknote,
  CreditCard,
  QrCode,
  Monitor,
  Smartphone,
  Store,
} from 'lucide-react'
import { corTempoPedido, textoTempoPedido } from '@/lib/tempo-pedido'
import { PainelPedido } from '@/components/pedidos/painel-pedido'
import { PEDIDO_SELECT, mapPedido } from '@/lib/queries/pedidos'
import { rotuloForma, statusAReceber } from '@/lib/pdv-pagamento'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RotaPanel } from '@/components/pedidos/rota-panel'
import { CancelarPedidoModal } from '@/components/pedidos/cancelar-modal'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarFluxoLoja, buscarStatusELoja, definirStatusLoja, FLUXO_LOJA_PADRAO, usaDespachoDeRotas } from '@/lib/queries/ajustes'
import { lojaEstaAberta, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { notificarPedido } from '@/lib/notificar'
import { etiquetasDoPedido, origemVisivelNoCard, rotuloOrigemPedido as origemDoCard } from '@/lib/pedido-origem'
import { SeloOrigem } from '@/components/icones/origens'
import { EtiquetaAtendimento } from '@/components/pedidos/etiquetas-pedido'
import { Capacete } from '@/components/icones/capacete'
import { Dica, Flutuante } from '@/components/ui/flutuante'
import { pedidoParado, tempoParado } from '@/lib/pedido-parado'
import { AvisosPedidos, type Aviso } from '@/components/pedidos/avisos-pedidos'
import { useAlarme } from '@/components/admin/alarme-global'
import { OPCOES_REPETICAO } from '@/lib/alarme-pedidos'
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


/** Selo do card sem fundo: ícone + texto (2026-10-03). */
const SELO = 'inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide'


// Milhar com ponto ("R$ 4.088,00"): função única do painel, ver lib/moeda.ts.
const brl = formatarReal

function tempoDecorrido(iso: string, now: number) {
  const totalSec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return { mins, label: `${mins}:${secs.toString().padStart(2, '0')}` }
}

/** Com o aceite automático ligado, o pedido toca o alarme por esse tempo antes de ir sozinho pra "Preparando". */
const AUTO_ACEITE_DELAY_MS = 5_000



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
  // Painel do pedido (2026-10-03): guarda o pedido aberto e acompanha as listas em tempo real.
  const [detail, setDetailSnap] = useState<Pedido | null>(null)
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
  // O alarme vive no layout (toca em qualquer tela do painel); aqui ficam só os controles.
  const alarme = useAlarme()!
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
  // Menus do topo (Mais e status da loja): portal por cima de tudo; Esc e clique fora fecham.
  const botaoStatus = useRef<HTMLButtonElement>(null)
  const botaoMais = useRef<HTMLButtonElement>(null)
  const fecharMenuLoja = useCallback(() => setLojaMenuOpen(false), [])
  const fecharMais = useCallback(() => setMaisAberto(false), [])

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

  // O alarme tem a própria fonte dos pedidos "recebido" (components/admin/alarme-global.tsx).
  useEffect(() => {
    ordersRef.current = orders
  }, [orders])

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

  const setDetail = useCallback((p: Pedido | null) => { setDetailSnap(p); setEditandoPag(false) }, [])
  const fecharPainel = useCallback(() => setDetail(null), [setDetail])
  // O painel acompanha o pedido em tempo real: a cada atualização das listas pega a versão
  // nova; se o pedido saiu delas (cancelado, concluído antigo), relê do banco.
  const detalheId = detail?.id ?? null
  useEffect(() => {
    if (!detalheId) return
    const atual = [...orders, ...agendados, ...transit, ...concluded].find((o) => o.id === detalheId)
    if (atual) { setDetailSnap((antes) => (antes && antes.id === atual.id ? atual : antes)); return }
    let vivo = true
    supabase.from('pedidos').select(PEDIDO_SELECT).eq('id', detalheId).maybeSingle()
      .then(({ data }) => { if (vivo && data) setDetailSnap((antes) => (antes && antes.id === detalheId ? mapPedido(data as never) : antes)) })
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, agendados, transit, concluded])

  // Link direto para um pedido (ex.: extrato do Fluxo de Caixa): /admin/pedidos?pedido=<id> abre o painel.
  // A RLS da loja manda: pedido de outra loja simplesmente não vem.
  useEffect(() => {
    if (!restauranteId) return
    const id = new URLSearchParams(window.location.search).get('pedido')
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return
    let vivo = true
    supabase.from('pedidos').select(PEDIDO_SELECT).eq('id', id).eq('restaurante_id', restauranteId).maybeSingle()
      .then(({ data }) => { if (vivo && data) setDetail(mapPedido(data as never)) })
    return () => { vivo = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restauranteId])

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

  // Topo do Kanban (v2, 2026-10-03): status com texto; o resto só ícone, quadrado, mesma altura.
  // Ligado = cor viva sólida com ícone claro; desligado = cinza-escuro com ícone claro (riscado
  // quando faz sentido). A dica (tooltip por cima de tudo) diz o estado e o que o clique faz.
  const QUAD = 'relative inline-flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[4px] text-white transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4] sm:h-[44px] sm:w-[44px]'
  const ICONE = 'h-[20px] w-[20px]'
  const DESLIGADO = 'bg-[#4B5563]'
  const ITEM = 'flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-text-main hover:bg-page'
  const estadoChip = (ligado: boolean) => (
    <span className={`ml-auto rounded-full px-1.5 py-[1px] text-[10.5px] font-bold text-white ${ligado ? 'bg-[#15803D]' : 'bg-[#4B5563]'}`}>{ligado ? 'Ligado' : 'Desligado'}</span>
  )
  const statusTexto = lojaStatus && lojaStatus.statusLoja !== 'automatico' ? 'Manual' : 'Automático'
  const dicaStatus = `${lojaAberta ? 'Recebendo pedidos' : 'Loja fechada'} (${statusTexto}) – clique para abrir ou fechar a loja`
  const dicaSom = alarme.somAtivo ? 'Som de pedido novo ligado – clique para desligar' : 'Som de pedido novo desligado – clique para ligar'
  const dicaAceite = autoAceitar
    ? 'Aceite automático ligado – pedido novo vai sozinho para Preparando. Clique para desligar'
    : 'Aceite automático desligado – pedidos novos esperam alguém aceitar. Clique para ligar'
  const comRotas = usaDespachoDeRotas(fluxo)
  const controles = (
    <>
      <Dica texto={dicaStatus}>
        <button
          ref={botaoStatus}
          onClick={() => setLojaMenuOpen((v) => !v)}
          aria-expanded={lojaMenuOpen}
          aria-haspopup="menu"
          aria-label={dicaStatus}
          className={`inline-flex h-[36px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110 sm:h-[44px] sm:px-3 ${lojaAberta ? 'bg-[#15803D]' : 'bg-[#B91C1C]'}`}
          data-testid="kanban-status-loja"
        >
          <span className="relative flex h-2.5 w-2.5">
            {lojaAberta && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />}
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <span className="max-[379px]:hidden xl:hidden">{lojaAberta ? 'Aberta' : 'Fechada'}</span>
          <span className="hidden xl:inline">{lojaAberta ? 'Recebendo pedidos' : 'Loja fechada'}</span>
          <span className="hidden rounded-full bg-black/25 px-1.5 py-[1px] text-[10.5px] font-bold xl:inline">{statusTexto}</span>
          <ChevronDown className="hidden h-4 w-4 opacity-90 sm:block" />
        </button>
      </Dica>
      <Flutuante ancora={botaoStatus} aberto={lojaMenuOpen} onFechar={fecharMenuLoja} alinhar="inicio" largura={264} testid="kanban-status-menu" rotulo="Status da loja" className="py-1.5">
        <button onClick={() => mudarStatusLoja('aberto_manual')} className={ITEM}>
          <span className="h-2 w-2 rounded-full bg-[#15803D]" /> Forçar aberta agora
        </button>
        <button onClick={() => mudarStatusLoja('fechado_manual')} className={ITEM}>
          <span className="h-2 w-2 rounded-full bg-[#B91C1C]" /> Fechar agora
        </button>
        <button onClick={() => mudarStatusLoja('automatico')} className={`${ITEM} border-t border-border`}>
          <span className="h-2 w-2 rounded-full bg-text-subtle" /> Voltar ao automático (grade de horário)
        </button>
        <p className="px-3 pb-1 pt-1.5 text-[11px] leading-tight text-text-subtle">
          Grade de horário semanal se configura em Ajustes. Forçar aberta/fechada aqui vale até você reverter.
        </p>
      </Flutuante>
      {alarme.tocando ? (
        <Dica texto="Alarme de pedido novo tocando – clique para silenciar (o próximo pedido novo toca de novo)">
          <button onClick={alarme.silenciar} aria-label="Silenciar o alarme de pedido novo" className={`${QUAD} bg-[#C2410C]`} data-testid="kanban-silenciar">
            <BellRing className={`${ICONE} animate-pulse`} />
          </button>
        </Dica>
      ) : (
        <Dica texto={dicaSom}>
          <button onClick={toggleSom} aria-pressed={alarme.somAtivo} aria-label={dicaSom} className={`${QUAD} max-sm:hidden ${alarme.somAtivo ? 'bg-[#0369A1]' : DESLIGADO}`} data-testid="kanban-som">
            {alarme.somAtivo ? <Bell className={ICONE} /> : <BellOff className={ICONE} />}
          </button>
        </Dica>
      )}
      <Dica texto={dicaAceite}>
        <button onClick={toggleAutoAceite} aria-pressed={autoAceitar} aria-label={dicaAceite} className={`${QUAD} max-sm:hidden ${autoAceitar ? 'bg-[#7E22CE]' : DESLIGADO}`} data-testid="kanban-aceite">
          {autoAceitar ? <Zap className={ICONE} fill="currentColor" /> : <ZapOff className={ICONE} />}
        </button>
      </Dica>
      {comRotas ? (
        <Dica texto="Rotas – abrir o despacho dos motoboys no mapa">
          <button onClick={() => setRotaOpen(true)} aria-label="Rotas – abrir o despacho dos motoboys no mapa" className={`${QUAD} max-sm:hidden bg-[#1F2937]`} data-testid="kanban-rotas">
            <Capacete className={ICONE} strokeWidth={2.2} />
          </button>
        </Dica>
      ) : (
        <Dica texto="Rotas desligado – esta loja não trabalha com motoboy (Ajustes › Entrega). A entrega é concluída aqui no Kanban">
          <span tabIndex={0} aria-label="Rotas desligado – esta loja não trabalha com motoboy" className="inline-flex flex-shrink-0 max-sm:hidden" data-testid="kanban-rotas-desligado">
            <button disabled data-rotas-desligado tabIndex={-1} aria-hidden className={`${QUAD} pointer-events-none cursor-not-allowed ${DESLIGADO}`}>
              <Capacete className={ICONE} strokeWidth={2.2} />
              <span aria-hidden className="absolute h-[2px] w-[26px] rotate-45 rounded-full bg-white" />
            </button>
          </span>
        </Dica>
      )}
      <Dica texto="Mais opções – testar som, repetição do alarme, métricas, entregas e tela cheia">
        <button ref={botaoMais} onClick={() => setMaisAberto((v) => !v)} aria-expanded={maisAberto} aria-haspopup="menu" aria-label="Mais opções" className={`${QUAD} bg-[#374151]`} data-testid="kanban-mais">
          <MoreHorizontal className={ICONE} />
        </button>
      </Dica>
      <Flutuante ancora={botaoMais} aberto={maisAberto} onFechar={fecharMais} alinhar="inicio" largura={300} testid="kanban-mais-menu" rotulo="Mais opções" className="py-1.5">
        {/* No celular, Som, Aceite automático e Rotas moram aqui. */}
        <div className="border-b border-border sm:hidden">
          {!alarme.tocando && (
            <button onClick={toggleSom} className={ITEM} data-testid="kanban-som-menu">
              {alarme.somAtivo ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} Som de pedido novo {estadoChip(alarme.somAtivo)}
            </button>
          )}
          <button onClick={toggleAutoAceite} className={ITEM} data-testid="kanban-aceite-menu">
            {autoAceitar ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />} Aceite automático {estadoChip(autoAceitar)}
          </button>
          {comRotas ? (
            <button onClick={() => { setRotaOpen(true); setMaisAberto(false) }} className={ITEM} data-testid="kanban-rotas-menu">
              <Capacete className="h-4 w-4" /> Rotas (despacho)
            </button>
          ) : (
            <p className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-subtle"><Capacete className="h-4 w-4" /> Rotas: desligado (sem motoboy)</p>
          )}
        </div>
        <button onClick={() => { void alarme.testar(); setMaisAberto(false) }} className={ITEM} data-testid="kanban-testar-som">
          <Volume2 className="h-4 w-4" /> Testar som
        </button>
        <div className="border-t border-border px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Repetir o alarme</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {OPCOES_REPETICAO.map((s) => (
              <button key={s} onClick={() => alarme.setRepetirSeg(s)} aria-pressed={alarme.repetirSeg === s}
                className={`h-[32px] rounded-[3px] border px-2 text-[12px] font-semibold ${alarme.repetirSeg === s ? 'border-[#0369A1] bg-[#0369A1] text-white' : 'border-border bg-white text-text-main hover:bg-page'}`} data-testid={`kanban-repetir-${s}`}>
                {s === 0 ? 'Não repetir' : `${s} s`}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-text-subtle">Repete enquanto houver pedido novo sem aceitar.</p>
        </div>
        {alarme.permissaoNotif !== 'sem_suporte' && (
          <button onClick={() => void alarme.pedirNotificacao()} disabled={alarme.permissaoNotif === 'granted'}
            className={`${ITEM} border-t border-border disabled:cursor-default disabled:hover:bg-white`} data-testid="kanban-notificacoes">
            <Bell className="h-4 w-4" />
            {alarme.permissaoNotif === 'granted' ? 'Notificações do navegador: ligadas' : alarme.permissaoNotif === 'denied' ? 'Notificações bloqueadas no navegador (libere no cadeado)' : 'Ligar notificações com a aba escondida'}
          </button>
        )}
        <div className="border-t border-border">
          <button onClick={() => { toggleStats(); setMaisAberto(false) }} aria-pressed={showStats} className={ITEM} data-testid="kanban-metricas">
            {showStats ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} Métricas no topo {estadoChip(showStats)}
          </button>
          <button onClick={() => { toggleCol4(); setMaisAberto(false) }} aria-pressed={showCol4} className={ITEM} data-testid="kanban-entregas">
            <Columns3 className="h-4 w-4" /> Entregas e concluídos {estadoChip(showCol4)}
          </button>
          <button onClick={() => { void toggleFocus(); setMaisAberto(false) }} className={`${ITEM} max-lg:hidden`} data-testid="kanban-tela-cheia">
            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />} {focusMode ? 'Sair da tela cheia' : 'Tela cheia'}
          </button>
        </div>
      </Flutuante>
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
  const topBar = <TopBar title="Painel de Pedidos" breadcrumb="Pedidos › Kanban" semTitulo controles={controles} sistema={avisosTopo} />

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

      {/* Quadro + painel do pedido lado a lado: o painel não cobre nem bloqueia o quadro. */}
      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-5">
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

        {/* Som bloqueado: o aviso grande sai do layout, em toda tela (AvisoSomBloqueado). */}

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
        <div className={`grid flex-1 grid-cols-1 gap-3 max-lg:flex max-lg:flex-col max-lg:overflow-y-auto ${detail ? `lg:overflow-x-auto lg:overflow-y-hidden ${showCol4 ? 'lg:grid-cols-[repeat(4,minmax(250px,1fr))]' : 'lg:grid-cols-[repeat(3,minmax(250px,1fr))]'}` : `overflow-hidden ${showCol4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}`} data-testid="kanban-quadro">
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
                    const idadeMs = now - new Date(order.criadoEm).getTime()
                    const corTempo = { ok: 'text-price-text', atencao: 'text-[#B45309]', atraso: 'text-danger' }[corTempoPedido(idadeMs)]
                    const selecionado = detail?.id === order.id
                    const IconePag = order.formaPagamento === 'dinheiro' ? Banknote : order.formaPagamento === 'pix' ? QrCode : CreditCard
                    const dicaPag = [
                      rotuloForma(order.formaPagamento, order.cartaoTipo),
                      order.pago ? 'Pago' : statusAReceber(order.tipo),
                      order.formaPagamento === 'dinheiro' && order.trocoPara ? `Troco p/ ${brl(order.trocoPara)}` : null,
                    ].filter(Boolean).join(' · ')
                    const abrir = () => setDetail(selecionado ? null : order)
                    return (
                      // Card mínimo (2026-10-03): 3 linhas. Clicar em qualquer parte abre o painel do
                      // pedido; o botão de etapa só avança (não abre o painel).
                      <div
                        key={order.id}
                        data-testid={`pedido-${order.numero}`}
                        data-selecionado={selecionado ? '1' : undefined}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selecionado}
                        aria-label={`Pedido #${order.numero}: abrir o painel`}
                        onClick={abrir}
                        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir() } }}
                        className={[
                          'cursor-pointer rounded-menuzia border border-l-[4px] px-3 pb-2 pt-2 shadow-md transition-[box-shadow,background-color] hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                          selecionado ? 'border-primary bg-primary/[0.06] ring-2 ring-primary/40' : 'border-border bg-white hover:bg-page/60',
                          accent[coluna],
                          order.status === 'recebido' && !order.preparandoNotificado ? 'animate-new-order' : '',
                          // Som bloqueado pelo navegador: o pedido novo pisca em vermelho até alguém tocar na tela.
                          order.status === 'recebido' && !order.preparandoNotificado && alarme.somAtivo && alarme.bloqueado ? 'animate-pulse ring-4 ring-[#DC2626]' : '',
                        ].join(' ')}
                      >
                        {/* Linha 1: número, origem, tempo e atendimento (sem fundo). */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="rounded-menuzia bg-text-main px-1.5 py-0.5 text-sm font-bold text-white">#{order.numero}</span>
                            {/* Origem do pedido da vitrine (item 55): só o ícone, ao lado do número, com a dica.
                                Direto, PDV, Mesa e Balcão não mostram nada. É a única mudança no card antigo. */}
                            {(() => {
                              const o = order.origemCanal && order.origemCanal !== 'direto' ? origemVisivelNoCard(order) : null
                              return o && !['pdv', 'mesa', 'balcao'].includes(o.icone) ? (
                                <Dica texto={o.dica}>
                                  <span className="inline-flex" aria-label={o.dica} data-testid="card-origem" data-origem={o.icone}>
                                    <SeloOrigem canal={o.icone} />
                                  </span>
                                </Dica>
                              ) : null
                            })()}
                            {origemDoCard(order).posto === 'Salão' && <span className={`${SELO} text-[#047857]`} data-testid="selo-origem"><Store className="h-3.5 w-3.5" aria-hidden /> Salão</span>}
                            {origemDoCard(order).posto === 'PDV' && <span className={`${SELO} text-alert-text`} data-testid="selo-origem"><Monitor className="h-3.5 w-3.5" aria-hidden /> PDV</span>}
                            {origemDoCard(order).posto === 'Delivery' && <span className={`${SELO} text-purple`} data-testid="selo-origem"><Smartphone className="h-3.5 w-3.5" aria-hidden /> Delivery</span>}
                            {order.agendadoPara && <Badge tone="alert">Agendado {textoAgendado(order.agendadoPara)}</Badge>}
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-bold tabular-nums ${corTempo}`}
                              title={pedidoParado(order, now) ? `Aberto há ${textoTempoPedido(idadeMs)}: ninguém fechou este pedido. Conclua ou cancele.` : 'Tempo desde que o pedido chegou'}
                              data-testid="card-tempo"
                            >
                              <Clock className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                              {textoTempoPedido(idadeMs)}
                            </span>
                            <EtiquetaAtendimento atendimento={etiquetasDoPedido(order).atendimento} semFundo />
                          </div>
                        </div>
                        {/* Linha 2: cliente (+ telefone) à esquerda; ícone da forma e valor à direita. */}
                        <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate text-[13.5px] font-semibold" title={order.clienteNome || undefined}>{order.clienteNome || 'Cliente'}</span>
                            {order.origem === 'pdv' && order.clienteTelefone && (
                              <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-text-subtle">{mascararTelefoneBR(order.clienteTelefone)}</span>
                            )}
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            {order.canal !== 'mesa' && (
                              <span className="inline-flex text-text-subtle" title={dicaPag} aria-label={dicaPag} data-testid="card-pagamento">
                                <IconePag className="h-[18px] w-[18px]" aria-hidden />
                              </span>
                            )}
                            <span className="whitespace-nowrap text-[14px] font-bold tabular-nums text-status-ready" data-testid="card-preco">{brl(order.total)}</span>
                          </div>
                        </div>
                        {/* Linha 3: só o botão de etapa (não abre o painel). */}
                        <div className="mt-2 flex [&>*]:whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {order.status === 'recebido' && (
                            <Button variant="primary" className="w-full gap-1.5" onClick={() => avancar(order)} data-testid="card-etapa">
                              Aceitar <ArrowRight className="h-4 w-4" aria-hidden />
                            </Button>
                          )}
                          {order.status === 'preparando' && (
                            <Button variant="success" className="w-full gap-1.5" onClick={() => avancar(order)} data-testid="card-etapa">
                              Pronto <ArrowRight className="h-4 w-4" aria-hidden />
                            </Button>
                          )}
                          {order.status === 'pronto' && order.tipo === 'retirada' && (
                            <Button variant="success" className="w-full gap-1.5" onClick={() => avancar(order)} data-testid="card-etapa">
                              Entregue <ArrowRight className="h-4 w-4" aria-hidden />
                            </Button>
                          )}
                          {order.status === 'pronto' && order.tipo === 'entrega' && !usaDespachoDeRotas(fluxo) && (
                            <Button variant="dispatch" className="w-full gap-1.5" onClick={() => saiuSemEntregador(order)} title="Avisa o cliente no WhatsApp e conclui o pedido" data-testid="card-etapa">
                              Saiu p/ entrega <ArrowRight className="h-4 w-4" aria-hidden />
                            </Button>
                          )}
                          {order.status === 'pronto' && order.tipo === 'entrega' && usaDespachoDeRotas(fluxo) && (
                            <span
                              className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-menuzia border border-[#0369A1]/25 bg-alert-bg px-2 text-[11px] font-bold uppercase tracking-wide text-alert-text lg:min-h-0 lg:py-2"
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
      {detail && (
        <PainelPedido
          pedido={detail}
          agora={now}
          onFechar={fecharPainel}
          editandoPag={editandoPag}
          setEditandoPag={setEditandoPag}
          onPagamentoAlterado={() => { if (restauranteId) refetch(restauranteId) }}
          reimpEstado={reimpEstado}
          onReimprimir={() => reimprimir(detail)}
          onCancelar={() => pedirCancelamento(detail)}
          concluirSemEntregador={fluxo.usaLogistica && !fluxo.entregaSemEntregador && detail.tipo === 'entrega' && (detail.status === 'pronto' || detail.status === 'em_rota')
            ? () => { const p = detail; setDetail(null); moverPara(p, 'entregue') }
            : undefined}
        />
      )}
      </div>

      {/* Painel de despacho de rotas */}
      {rotaOpen && restauranteId && usaDespachoDeRotas(fluxo) && (
        <RotaPanel supabase={supabase} restauranteId={restauranteId} apiKey={mapsKey} onClose={() => setRotaOpen(false)} />
      )}

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
