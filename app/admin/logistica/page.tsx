'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Bike, Package, Truck, Users, ClipboardCheck, Phone, User, MapPin, Plus, Wallet, ArrowRight, Zap, RefreshCw, Volume2, VolumeX, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RouteMap } from '@/components/maps/route-map'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { notificarPedido } from '@/lib/notificar'
import { invalidarCotacaoNexta, useCotacoesNexta, type CotacaoNextaEstado } from '@/lib/nexta-cotacao-cache'
import { motivoRejeicaoTexto, nextaEntregaAtiva, nextaEventoTexto } from '@/lib/nexta-eventos'
import { listarNextaEntregas, type NextaEntregaLinha } from '@/lib/queries/nexta'
import {
  atribuirEntregador,
  atribuirEntregadorEmLote,
  atualizarPerfilEntregador,
  buscarDespachoAberto,
  criarEntregador,
  definirDespachoAberto,
  enderecoCompletoPedido,
  enviarFotoEntregador,
  listarEntregadores,
  listarPedidosConcluidos,
  listarPedidosLogistica,
  listarResumoCaixa,
  marcarPedidoEntregue,
  recusarPedido,
  registrarFechamentoCaixa,
  type Entregador,
  type Pedido,
  type ResumoCaixa,
  type StatusEntregador,
} from '@/lib/queries/pedidos'

type Tab = 'despacho' | 'concluidos' | 'entregadores'

/**
 * Coluna visível abaixo de `lg`. No desktop as duas aparecem lado a lado; no celular
 * viram abas, pra não empilhar duas listas longas numa tela só.
 */
type ColunaMobile = 'prontos' | 'rota'

/** Chave do localStorage que lembra se o operador recolheu os cards de resumo. */
const RESUMO_KEY = 'menuzia:logistica:resumo'

const TABS: { id: Tab; label: string }[] = [
  { id: 'despacho', label: 'Despacho' },
  { id: 'concluidos', label: 'Concluídos' },
  { id: 'entregadores', label: 'Entregadores' },
]

/**
 * Aba do query param (`?tab=`), pra deep-link e pra não perder o lugar num refresh.
 * Lida só depois da montagem — ler `window` no estado inicial quebraria a hidratação.
 */
function tabDaUrl(): Tab | null {
  const valor = new URLSearchParams(window.location.search).get('tab')
  return TABS.some((t) => t.id === valor) ? (valor as Tab) : null
}

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

const brl = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}`
const PAY_LABEL: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', dinheiro: 'Dinheiro' }

const STATUS_LABEL: Record<StatusEntregador, string> = { online: 'Disponível', ocupado: 'Ocupado', offline: 'Offline' }
const STATUS_DOT: Record<StatusEntregador, string> = { online: 'bg-status-ready', ocupado: 'bg-status-pending', offline: 'bg-text-subtle' }

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

function tempoRelativo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min === 1) return 'há 1 min'
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)}h`
}

function endereco(p: Pedido) {
  const partes = [p.enderecoBairro, p.enderecoRua && `${p.enderecoRua}, ${p.enderecoNumero}`].filter(Boolean)
  return partes.join(' · ') || 'Entrega'
}

const STAT_TINT: Record<'slate' | 'orange' | 'blue' | 'primary', { box: string; value: string }> = {
  slate: { box: 'bg-page text-text-subtle', value: '' },
  orange: { box: 'bg-status-pending/10 text-status-pending', value: 'text-status-pending' },
  blue: { box: 'bg-status-preparing/10 text-status-preparing', value: 'text-status-preparing' },
  primary: { box: 'bg-primary/10 text-primary', value: '' },
}

// Painel do lojista Nexta — não tem deep link por entrega (o id que eles usam na UI deles
// é interno e nunca chega até nós), então o atalho abre o monitor geral.
const NEXTA_PAINEL_URL = 'https://nexta-est.flutterflow.app/monitor'

/** Etapas mostradas na timeline do card "Com o Nexta", na ordem do ciclo. */
const TIMELINE_NEXTA: { status: string; label: string }[] = [
  { status: 'PENDING', label: 'Aguardando aceite' },
  { status: 'ACCEPTED', label: 'Aceito' },
  { status: 'PICKUP_ONGOING', label: 'Indo coletar' },
  { status: 'ARRIVED_AT_MERCHANT', label: 'Na loja' },
]

/**
 * Alerta sonoro dos marcos do Nexta. Mesmo padrão de Web Audio do Kanban
 * (`playNewOrderSound`), com timbres distintos por tipo de evento:
 * subindo = entregador vindo buscar; descendo = deu problema.
 */
function playNextaSound(tipo: 'indo_coletar' | 'aviso' | 'erro') {
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
    const notas: Record<typeof tipo, [number, number]> = {
      indo_coletar: [660, 990], // sobe: o motoboy está vindo
      aviso: [880, 880],
      erro: [660, 440], // desce: rejeição/cancelamento
    }
    const [a, b] = notas[tipo]
    beep(a, 0)
    beep(b, 0.18)
    setTimeout(() => ctx.close(), 600)
  } catch {
    /* navegador sem suporte a Web Audio — silencioso */
  }
}

/**
 * Chip de cotação do Nexta no card do pedido. Falhar em cotar não pode atrapalhar o
 * despacho próprio: vira um chip cinza discreto com o motivo no tooltip.
 */
function ChipNexta({ estado }: { estado: CotacaoNextaEstado | undefined }) {
  if (!estado || estado.status === 'carregando') {
    return (
      <span className="inline-flex animate-pulse items-center gap-1.5 rounded-menuzia bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle">
        <Zap className="h-3 w-3" /> Cotando Nexta…
      </span>
    )
  }
  if (estado.status === 'erro') {
    return (
      <span
        title={estado.erro}
        className="inline-flex cursor-help items-center gap-1.5 rounded-menuzia bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle"
      >
        <Zap className="h-3 w-3" /> Nexta indisponível
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold text-price-text">
      <Zap className="h-3 w-3" strokeWidth={2.5} /> Nexta {brl(estado.preco)}
      {estado.etaColetaMin !== null && (
        <span className="font-medium text-text-subtle">· coleta ~{Math.round(estado.etaColetaMin)} min</span>
      )}
    </span>
  )
}

/** Primeira opção do dropdown "Atribuir entregador": o Nexta, como um entregador virtual. */
function OpcaoNexta({ rotulo, detalhe, onClick, disabled }: { rotulo: string; detalhe: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-2 rounded-menuzia border-l-2 border-l-primary px-3 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page disabled:opacity-60"
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <Zap className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} /> {rotulo}
      </span>
      <span className="text-xs text-text-subtle">{detalhe}</span>
    </button>
  )
}

/** Preço + ETA de uma cotação, no lado direito da opção do dropdown. */
function detalheCotacao(cotacao: CotacaoNextaEstado | undefined): React.ReactNode {
  if (cotacao?.status === 'ok') {
    return (
      <>
        <span className="font-bold text-price-text">{brl(cotacao.preco)}</span>
        {cotacao.etaColetaMin !== null && ` · coleta ~${Math.round(cotacao.etaColetaMin)} min`}
      </>
    )
  }
  return cotacao?.status === 'erro' ? 'sem cotação' : 'cotando…'
}

/** Card de métrica da Logística — caixa de ícone colorida + valor, no mesmo padrão do Kanban. */
function StatCard({ tint, value, label, icon }: { tint: keyof typeof STAT_TINT; value: React.ReactNode; label: string; icon: React.ReactNode }) {
  const t = STAT_TINT[tint]
  return (
    <div className="flex items-center gap-3 rounded-menuzia border border-border bg-white p-4">
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-menuzia ${t.box}`}>{icon}</div>
      <div>
        <div className={`text-2xl font-bold leading-none ${t.value}`}>{value}</div>
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</div>
      </div>
    </div>
  )
}

export default function LogisticaPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [orders, setOrders] = useState<Pedido[]>([])
  const [concluidos, setConcluidos] = useState<Pedido[]>([])
  const [drivers, setDrivers] = useState<Entregador[]>([])
  const [despachoAberto, setDespachoAberto] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  /** Altura aproximada do menu de atribuir — usada só pra decidir o lado da abertura. */
  const ALTURA_MENU_ATRIBUIR = 200
  /** true quando o menu de atribuir precisa abrir pra cima por falta de espaço embaixo. */
  const [assignAcima, setAssignAcima] = useState(false)
  const [closingOpen, setClosingOpen] = useState(false)

  const [linkDriver, setLinkDriver] = useState<Entregador | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [locationDriverId, setLocationDriverId] = useState<string | null>(null)
  const [profileDriverId, setProfileDriverId] = useState<string | null>(null)
  const [perfilForm, setPerfilForm] = useState({ nome: '', telefone: '', veiculo: '', placa: '', fotoUrl: '' })
  const [perfilSaving, setPerfilSaving] = useState(false)
  const [perfilSaved, setPerfilSaved] = useState(false)
  const [perfilError, setPerfilError] = useState<string | null>(null)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<Tab>('despacho')
  const [colunaMobile, setColunaMobile] = useState<ColunaMobile>('prontos')
  // Começa visível sempre: o valor salvo só entra depois da montagem, senão o primeiro
  // render do servidor e o do cliente divergem e a hidratação quebra.
  const [resumoVisivel, setResumoVisivel] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAssigning, setBulkAssigning] = useState(false)

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'entregue' | 'cancelado'>('todos')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')

  const [novoDriver, setNovoDriver] = useState({ nome: '', telefone: '' })
  const [addingDriver, setAddingDriver] = useState(false)
  const [addDriverOpen, setAddDriverOpen] = useState(false)

  const [resumo, setResumo] = useState<ResumoCaixa[]>([])
  const [declarado, setDeclarado] = useState<Record<string, string>>({})

  const [nextaAtivo, setNextaAtivo] = useState(false)
  const [nextaEntregas, setNextaEntregas] = useState<NextaEntregaLinha[]>([])
  const [nextaBusy, setNextaBusy] = useState<string | null>(null)
  const [cancelandoNexta, setCancelandoNexta] = useState<string | null>(null)
  const [somNexta, setSomNexta] = useState(false)
  // Status já visto por entrega — é a comparação com ele que decide se toca o som.
  const statusNextaVisto = useRef<Map<string, string>>(new Map())

  const refetch = useCallback(
    async (id: string) => {
      try {
        const [pedidos, entregadores, finalizados, aberto, entregasNexta] = await Promise.all([
          listarPedidosLogistica(supabase, id),
          listarEntregadores(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
          buscarDespachoAberto(supabase, id),
          // Janela curta: além das entregas em andamento, precisamos das recém-recusadas
          // pra avisar o lojista por que aquele pedido voltou pra fila.
          listarNextaEntregas(supabase, id, new Date(Date.now() - 12 * 3600 * 1000).toISOString()).catch(() => []),
        ])
        setOrders(pedidos)
        setDrivers(entregadores)
        setConcluidos(finalizados)
        setDespachoAberto(aberto)
        setNextaEntregas(entregasNexta)
      } catch {
        setError('Não foi possível carregar a logística.')
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
        .channel(`logistica-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${id}` }, () => refetch(id))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'entregadores', filter: `restaurante_id=eq.${id}` }, () => refetch(id))
        // Eventos do Nexta chegam por webhook e viram UPDATE nesta tabela — é assim que
        // "entregador a caminho" aparece na tela sem ninguém dar refresh.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'nexta_entregas', filter: `restaurante_id=eq.${id}` }, () => refetch(id))
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase, refetch])

  useEffect(() => {
    const inicial = tabDaUrl()
    if (inicial) setTab(inicial)
  }, [])

  // A config do Nexta mora numa tabela sem RLS pra `authenticated` (guarda o segredo),
  // então quem responde é o route handler.
  useEffect(() => {
    fetch('/api/admin/nexta/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { ativo: boolean } | null } | null) => setNextaAtivo(Boolean(d?.config?.ativo)))
      .catch(() => setNextaAtivo(false))
  }, [])

  function irParaTab(proxima: Tab) {
    setTab(proxima)
    const url = new URL(window.location.href)
    if (proxima === 'despacho') url.searchParams.delete('tab')
    else url.searchParams.set('tab', proxima)
    // replaceState em vez de router.push: trocar de aba não merece entrada no histórico
    // e não pode remontar a página (mataria o realtime e as cotações em cache).
    window.history.replaceState(null, '', url)
  }

  // Refetch periódico — "motoboy online" depende do horário atual, então precisa
  // recalcular mesmo sem eventos de realtime (ex.: motoboy fechou o app).
  useEffect(() => {
    if (!restauranteId) return
    const interval = setInterval(() => refetch(restauranteId), 10000)
    return () => clearInterval(interval)
  }, [restauranteId, refetch])

  const available = drivers.filter((d) => d.status === 'online')
  /** Prontos sem entregador próprio — inclui os que já foram mandados pro Nexta. */
  const unassignedTodos = useMemo(() => orders.filter((o) => o.status === 'pronto' && !o.entregadorId), [orders])
  const inRoute = orders.filter((o) => o.status === 'em_rota')

  // Entrega ativa do Nexta por pedido — é o que tira o pedido da fila de despacho.
  const nextaPorPedido = useMemo(() => {
    const mapa = new Map<string, NextaEntregaLinha>()
    for (const e of nextaEntregas) if (nextaEntregaAtiva(e.status)) mapa.set(e.pedidoId, e)
    return mapa
  }, [nextaEntregas])

  /** Pedidos "Com o Nexta": solicitados e ainda não coletados (depois disso viram "Em rota"). */
  const comNexta = useMemo(
    () => unassignedTodos.filter((o) => nextaPorPedido.has(o.id)),
    [unassignedTodos, nextaPorPedido]
  )

  /**
   * Última tentativa recusada/cancelada de cada pedido que voltou pra fila. Sem isso o
   * pedido reaparece no despacho sem explicação nenhuma.
   */
  const falhasNexta = useMemo(() => {
    const mapa = new Map<string, NextaEntregaLinha>()
    for (const e of nextaEntregas) {
      if (e.status !== 'REJECTED' && e.status !== 'CANCELLED') continue
      if (nextaPorPedido.has(e.pedidoId)) continue // já tem tentativa nova rodando
      const atual = mapa.get(e.pedidoId)
      if (!atual || e.atualizadoEm > atual.atualizadoEm) mapa.set(e.pedidoId, e)
    }
    return mapa
  }, [nextaEntregas, nextaPorPedido])

  /** Fila de despacho de verdade: tira quem já está com o Nexta (tem seção própria). */
  const unassigned = useMemo(() => unassignedTodos.filter((o) => !nextaPorPedido.has(o.id)), [unassignedTodos, nextaPorPedido])

  // Cotações só dos pedidos que estão de fato esperando despacho, e só quando o lojista
  // está olhando pra eles — não faz sentido cotar em segundo plano na aba Concluídos.
  const idsParaCotar = useMemo(() => (tab === 'despacho' ? unassigned.map((o) => o.id) : []), [tab, unassigned])
  const cotacoesNexta = useCotacoesNexta(idsParaCotar, nextaAtivo)

  /** Soma das cotações dos pedidos marcados — o custo do despacho em lote pelo Nexta. */
  const totalNextaSelecionado = useMemo(() => {
    let total = 0
    let cotados = 0
    for (const id of selected) {
      const c = cotacoesNexta[id]
      if (c?.status === 'ok') {
        total += c.preco
        cotados++
      }
    }
    return { total, cotados }
  }, [selected, cotacoesNexta])

  // Pedido que saiu da fila (foi pro Nexta, ou um motoboy pegou pelo app) não pode
  // continuar marcado: o despacho em lote tentaria atribuí-lo de novo.
  useEffect(() => {
    setSelected((prev) => {
      const validos = new Set(unassigned.map((o) => o.id))
      if ([...prev].every((id) => validos.has(id))) return prev
      return new Set([...prev].filter((id) => validos.has(id)))
    })
  }, [unassigned])

  useEffect(() => {
    setSomNexta(localStorage.getItem('menuzia:logistica-som') !== 'off')
  }, [])

  useEffect(() => {
    setResumoVisivel(localStorage.getItem(RESUMO_KEY) !== 'oculto')
  }, [])

  function alternarResumo() {
    setResumoVisivel((atual) => {
      const proximo = !atual
      localStorage.setItem(RESUMO_KEY, proximo ? 'visivel' : 'oculto')
      return proximo
    })
  }

  function alternarSomNexta() {
    setSomNexta((atual) => {
      const proximo = !atual
      localStorage.setItem('menuzia:logistica-som', proximo ? 'on' : 'off')
      return proximo
    })
  }

  // Som nos marcos do Nexta. Compara com o status já visto pra tocar uma vez por
  // transição — os eventos de movimento repetem sozinhos e apitariam sem parar.
  useEffect(() => {
    const vistos = statusNextaVisto.current
    const primeiraCarga = vistos.size === 0
    for (const e of nextaEntregas) {
      const antes = vistos.get(e.id)
      vistos.set(e.id, e.status)
      // Na primeira carga da página tudo é "novo" — apitar aqui seria só barulho.
      if (primeiraCarga || antes === undefined || antes === e.status || !somNexta) continue
      if (e.status === 'PICKUP_ONGOING') playNextaSound('indo_coletar')
      else if (e.status === 'ARRIVED_AT_MERCHANT' || e.status === 'RETURNING_TO_MERCHANT' || e.status === 'RETURNED_TO_MERCHANT') playNextaSound('aviso')
      else if (e.status === 'REJECTED' || e.status === 'CANCELLED') playNextaSound('erro')
    }
  }, [nextaEntregas, somNexta])

  /** Manda um pedido pro Nexta. O servidor recota na hora — o preço do chip é só vitrine. */
  async function despacharNexta(orderId: string): Promise<boolean> {
    setAssigning(null)
    setNextaBusy(orderId)
    setError(null)
    try {
      const res = await fetch('/api/admin/nexta/despachar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: orderId }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Falha ao enviar ao Nexta.')
      invalidarCotacaoNexta(orderId)
      if (restauranteId) await refetch(restauranteId)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o pedido ao Nexta.')
      return false
    } finally {
      setNextaBusy(null)
    }
  }

  /** Despacho em lote: 1 corrida por pedido, sequencial. Sucesso parcial é reportado. */
  async function despacharNextaEmLote() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBulkAssigning(false)
    setNextaBusy('lote')
    setError(null)
    const falhas: string[] = []
    for (const id of ids) {
      try {
        const res = await fetch('/api/admin/nexta/despachar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pedidoId: id }),
        })
        if (!res.ok) throw new Error()
        invalidarCotacaoNexta(id)
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      } catch {
        falhas.push(orders.find((o) => o.id === id)?.numero.toString() ?? id)
      }
    }
    setNextaBusy(null)
    if (falhas.length > 0) setError(`Não foi possível enviar ao Nexta: pedido(s) #${falhas.join(', #')}. Os demais foram enviados.`)
    if (restauranteId) await refetch(restauranteId)
  }

  async function cancelarNexta(orderId: string) {
    setNextaBusy(orderId)
    setCancelandoNexta(null)
    try {
      const res = await fetch('/api/admin/nexta/cancelar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: orderId, reason: 'PROBLEM_AT_MERCHANT', action: 'CANCEL_DELIVERY' }),
      })
      const data = (await res.json()) as { error?: string; additionalCharges?: boolean }
      if (!res.ok) throw new Error(data.error ?? 'Falha ao cancelar no Nexta.')
      if (data.additionalCharges) setError('Corrida cancelada — o Nexta informou que este cancelamento tem cobrança adicional.')
      if (restauranteId) await refetch(restauranteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível cancelar no Nexta.')
    } finally {
      setNextaBusy(null)
    }
  }

  async function reconciliarNexta(orderId: string) {
    setNextaBusy(orderId)
    try {
      await fetch('/api/admin/nexta/reconciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: orderId }),
      })
      if (restauranteId) await refetch(restauranteId)
    } catch {
      setError('Não foi possível atualizar a entrega no Nexta.')
    } finally {
      setNextaBusy(null)
    }
  }
  const locationDriver = drivers.find((d) => d.id === locationDriverId) ?? null
  const profileDriver = drivers.find((d) => d.id === profileDriverId) ?? null
  const locationDriverStops = locationDriver
    ? orders
        .filter((o) => o.entregadorId === locationDriver.id && o.status === 'em_rota')
        .map((o, i) => ({ id: o.id, numero: i + 1, address: enderecoCompletoPedido(o) }))
    : []

  const concluidosFiltrados = useMemo(() => {
    const busca = filtroBusca.trim().toLowerCase()
    const min = filtroValorMin.trim() === '' ? null : Number(filtroValorMin.replace(/\./g, '').replace(',', '.'))
    const max = filtroValorMax.trim() === '' ? null : Number(filtroValorMax.replace(/\./g, '').replace(',', '.'))
    return concluidos.filter((o) => {
      if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
      if (busca && !(o.clienteNome.toLowerCase().includes(busca) || o.enderecoBairro.toLowerCase().includes(busca))) return false
      if (min !== null && Number.isFinite(min) && o.total < min) return false
      if (max !== null && Number.isFinite(max) && o.total > max) return false
      return true
    })
  }, [concluidos, filtroBusca, filtroStatus, filtroValorMin, filtroValorMax])

  const filtrosAtivos = filtroBusca !== '' || filtroStatus !== 'todos' || filtroValorMin !== '' || filtroValorMax !== ''

  function limparFiltros() {
    setFiltroBusca('')
    setFiltroStatus('todos')
    setFiltroValorMin('')
    setFiltroValorMax('')
  }

  function driverName(id: string | null) {
    if (!id) return '—'
    return drivers.find((d) => d.id === id)?.nome ?? '—'
  }

  function portalUrl(driver: Entregador) {
    if (typeof window === 'undefined') return ''
    return `${window.location.origin}/entregador/${driver.token}`
  }

  useEffect(() => {
    if (!linkDriver) {
      setQrDataUrl(null)
      return
    }
    setLinkCopied(false)
    QRCode.toDataURL(portalUrl(linkDriver), { width: 240, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null))
  }, [linkDriver])

  async function copiarLink() {
    if (!linkDriver) return
    try {
      await navigator.clipboard.writeText(portalUrl(linkDriver))
      setLinkCopied(true)
    } catch {
      setLinkCopied(false)
    }
  }

  useEffect(() => {
    if (!profileDriver) return
    setPerfilForm({
      nome: profileDriver.nome,
      telefone: profileDriver.telefone,
      veiculo: profileDriver.veiculo,
      placa: profileDriver.placa,
      fotoUrl: profileDriver.fotoUrl ?? '',
    })
    setPerfilSaved(false)
    setPerfilError(null)
  }, [profileDriver])

  async function handleFotoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !profileDriver || !restauranteId) return
    setUploadingFoto(true)
    setPerfilError(null)
    try {
      const url = await enviarFotoEntregador(supabase, restauranteId, profileDriver.id, file)
      setPerfilForm((f) => ({ ...f, fotoUrl: url }))
      setPerfilSaved(false)
    } catch {
      setPerfilError('Não foi possível enviar a foto.')
    } finally {
      setUploadingFoto(false)
    }
  }

  async function savePerfil() {
    if (!profileDriver || !restauranteId || !perfilForm.nome.trim()) return
    setPerfilSaving(true)
    setPerfilError(null)
    try {
      await atualizarPerfilEntregador(supabase, profileDriver.id, {
        nome: perfilForm.nome.trim(),
        telefone: perfilForm.telefone.trim(),
        veiculo: perfilForm.veiculo.trim(),
        placa: perfilForm.placa.trim(),
        fotoUrl: perfilForm.fotoUrl.trim() || null,
      })
      await refetch(restauranteId)
      setPerfilSaved(true)
    } catch {
      setPerfilError('Não foi possível salvar o perfil.')
    } finally {
      setPerfilSaving(false)
    }
  }

  async function assign(orderId: string, driverId: string) {
    setAssigning(null)
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, entregadorId: driverId, status: 'em_rota' } : o)))
    setSelected((prev) => {
      if (!prev.has(orderId)) return prev
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
    try {
      await atribuirEntregador(supabase, orderId, driverId)
      notificarPedido(orderId, 'em_rota')
    } catch {
      setError('Não foi possível atribuir o entregador.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  function toggleSelect(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  async function assignBulk(driverId: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setBulkAssigning(false)
    setOrders((prev) => prev.map((o) => (ids.includes(o.id) ? { ...o, entregadorId: driverId, status: 'em_rota' } : o)))
    setSelected(new Set())
    try {
      await atribuirEntregadorEmLote(supabase, ids, driverId)
      for (const id of ids) notificarPedido(id, 'em_rota')
    } catch {
      setError('Não foi possível atribuir os pedidos selecionados.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  async function deliver(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      await marcarPedidoEntregue(supabase, orderId)
      notificarPedido(orderId, 'entregue')
      if (restauranteId) refetch(restauranteId)
    } catch {
      setError('Não foi possível marcar como entregue.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  async function naoEntregue(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      await recusarPedido(supabase, orderId)
      notificarPedido(orderId, 'cancelado')
      if (restauranteId) refetch(restauranteId)
    } catch {
      setError('Não foi possível marcar como não entregue.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  async function toggleDespacho() {
    if (!restauranteId) return
    const next = !despachoAberto
    setDespachoAberto(next)
    try {
      await definirDespachoAberto(supabase, restauranteId, next)
    } catch {
      setDespachoAberto(!next)
      setError('Não foi possível alterar o despacho aberto.')
    }
  }

  async function addDriver() {
    if (!restauranteId || !novoDriver.nome.trim()) return
    setAddingDriver(true)
    try {
      await criarEntregador(supabase, restauranteId, novoDriver.nome.trim(), novoDriver.telefone.trim())
      setNovoDriver({ nome: '', telefone: '' })
      setAddDriverOpen(false)
      await refetch(restauranteId)
    } catch {
      setError('Não foi possível cadastrar o entregador.')
    } finally {
      setAddingDriver(false)
    }
  }

  async function openClosing() {
    if (!restauranteId) return
    try {
      setResumo(await listarResumoCaixa(supabase, restauranteId))
    } catch {
      setError('Não foi possível calcular o caixa.')
    }
    setClosingOpen(true)
  }

  async function saveClosing(r: ResumoCaixa) {
    if (!restauranteId) return
    const valor = Number((declarado[r.entregadorId] ?? '').replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(valor)) return
    try {
      await registrarFechamentoCaixa(supabase, restauranteId, r.entregadorId, r.valorEsperado, r.trocoLevado, valor)
      setResumo(await listarResumoCaixa(supabase, restauranteId))
      setDeclarado((prev) => ({ ...prev, [r.entregadorId]: '' }))
    } catch {
      setError('Não foi possível registrar o fechamento.')
    }
  }

  if (loading) {
    return (
      <>
        <TopBar title="Logística" breadcrumb="Logística › Despacho de entregas" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando logística…</div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Logística" breadcrumb="Logística › Despacho de entregas" />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-5">
        {error && (
          <div className="flex-shrink-0 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}

        <div className="flex flex-shrink-0 flex-col gap-2">
          <div className="flex justify-end">
            <button
              onClick={alternarResumo}
              className="inline-flex items-center gap-1 rounded-menuzia px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle transition-colors hover:bg-page hover:text-text-main"
            >
              {resumoVisivel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {resumoVisivel ? 'Ocultar resumo' : 'Mostrar resumo'}
            </button>
          </div>
          {resumoVisivel && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard tint="primary" value={available.length} label="Entregadores online" icon={<Bike className="h-5 w-5" strokeWidth={2} />} />
              <StatCard tint="orange" value={unassigned.length} label="Aguardando despacho" icon={<Package className="h-5 w-5" strokeWidth={2} />} />
              <StatCard tint="blue" value={inRoute.length} label="Em rota" icon={<Truck className="h-5 w-5" strokeWidth={2} />} />
              <StatCard tint="slate" value={drivers.length} label="Entregadores cadastrados" icon={<Users className="h-5 w-5" strokeWidth={2} />} />
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 gap-0.5 border-b border-border">
          {TABS.map((t) => {
            const contador = t.id === 'concluidos' ? concluidos.length : t.id === 'entregadores' ? drivers.length : unassigned.length
            return (
              <button
                key={t.id}
                onClick={() => irParaTab(t.id)}
                className={[
                  'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
                  tab === t.id ? 'border-tab-active bg-tab-active text-white' : 'border-transparent text-text-subtle hover:text-text-main',
                ].join(' ')}
              >
                {t.label}
                {contador > 0 && (
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                      tab === t.id ? 'bg-white/20 text-white' : 'bg-page text-text-subtle'
                    }`}
                  >
                    {contador}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Entregadores */}
          {tab === 'entregadores' && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="flex items-center justify-between bg-text-main px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" strokeWidth={2.5} />
                <h3 className="text-sm font-bold">Entregadores</h3>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{drivers.length}</span>
              </div>
              <div className="flex items-center gap-2">
                {!addDriverOpen && (
                  <button
                    onClick={() => setAddDriverOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
                  >
                    <Plus className="h-4 w-4" /> Entregador
                  </button>
                )}
                <button
                  onClick={openClosing}
                  className="inline-flex items-center gap-1.5 rounded-menuzia bg-yellow-300 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-black transition-colors hover:bg-yellow-400"
                >
                  <Wallet className="h-4 w-4" /> Fechamento de caixa
                </button>
              </div>
            </div>
            {addDriverOpen && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border bg-page/60 p-3">
                <input
                  value={novoDriver.nome}
                  onChange={(e) => setNovoDriver((d) => ({ ...d, nome: e.target.value }))}
                  placeholder="Nome do entregador"
                  autoFocus
                  className="min-w-[180px] flex-1 rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                />
                <input
                  value={novoDriver.telefone}
                  onChange={(e) => setNovoDriver((d) => ({ ...d, telefone: e.target.value }))}
                  placeholder="Telefone (opcional)"
                  className="min-w-[160px] flex-1 rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAddDriverOpen(false)
                    setNovoDriver({ nome: '', telefone: '' })
                  }}
                >
                  Cancelar
                </Button>
                <Button variant="primary" onClick={addDriver} disabled={addingDriver || !novoDriver.nome.trim()}>
                  {addingDriver ? 'Adicionando…' : 'Adicionar'}
                </Button>
              </div>
            )}
            <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 xl:grid-cols-3">
              {drivers.length === 0 && (
                <div className="col-span-full px-2 py-10 text-center text-sm text-text-subtle">Nenhum entregador cadastrado ainda.</div>
              )}
              {drivers.map((driver) => (
                <div key={driver.id} className="h-fit rounded-menuzia border border-border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{driver.nome}</span>
                    <div className="flex flex-shrink-0 items-center gap-2.5">
                      {driver.telefone ? (
                        <a
                          href={`tel:${driver.telefone}`}
                          title={`Ligar para ${driver.telefone}`}
                          className="flex h-4 w-4 items-center justify-center text-text-subtle hover:text-primary"
                        >
                          <Phone className="h-3.5 w-3.5" strokeWidth={2.25} />
                        </a>
                      ) : (
                        <span title="Sem telefone cadastrado" className="flex h-4 w-4 items-center justify-center text-border">
                          <Phone className="h-3.5 w-3.5" strokeWidth={2.25} />
                        </span>
                      )}
                      <button
                        onClick={() => setProfileDriverId(driver.id)}
                        title="Perfil do entregador"
                        className="flex h-4 w-4 items-center justify-center text-text-subtle hover:text-primary"
                      >
                        <User className="h-3.5 w-3.5" strokeWidth={2.25} />
                      </button>
                      <button
                        onClick={() => setLocationDriverId(driver.id)}
                        title={
                          driver.online
                            ? 'Motoboy online — ver localização'
                            : driver.localizacao
                              ? 'Ver última localização conhecida'
                              : 'Localização ainda não disponível'
                        }
                        className={`flex h-4 w-4 items-center justify-center ${
                          driver.online ? 'text-danger' : driver.localizacao ? 'text-warn' : 'text-border'
                        }`}
                      >
                        <MapPin className="h-3.5 w-3.5" strokeWidth={2.25} />
                      </button>
                      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[driver.status]}`} title={STATUS_LABEL[driver.status]} />
                    </div>
                  </div>
                  <div className="mb-2 flex items-center justify-between text-xs text-text-subtle">
                    <span>{STATUS_LABEL[driver.status]}</span>
                    <span>{driver.emRota} entrega(s) em rota</span>
                  </div>
                  {driver.online ? (
                    <div className="flex w-full items-center justify-center gap-1.5 rounded-menuzia border border-status-ready/30 bg-status-ready/10 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-ready">
                      Motoboy online no app
                    </div>
                  ) : (
                    <button
                      onClick={() => setLinkDriver(driver)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-menuzia border border-border py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:border-primary hover:text-primary"
                    >
                      Acesso do entregador (link/QR)
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
          )}

          {/* Pedidos */}
          {tab !== 'entregadores' && (
          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            {tab === 'despacho' && (
            <>
            {/* Abaixo de lg as duas colunas viram abas — empilhar duas listas longas
                num celular esconde justamente o que o operador precisa alcançar. */}
            <div className="flex flex-shrink-0 gap-1 rounded-menuzia border border-border bg-white p-1 lg:hidden">
              {([
                { id: 'prontos' as const, label: 'Prontos', contador: unassigned.length },
                { id: 'rota' as const, label: 'Em rota', contador: comNexta.length + inRoute.length },
              ]).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setColunaMobile(c.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-menuzia px-3 py-2 text-[12px] font-bold uppercase tracking-wide transition-colors ${
                    colunaMobile === c.id ? 'bg-primary text-white' : 'text-text-subtle hover:bg-page hover:text-text-main'
                  }`}
                >
                  {c.label}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                      colunaMobile === c.id ? 'bg-white/20 text-white' : 'bg-page text-text-subtle'
                    }`}
                  >
                    {c.contador}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:grid lg:grid-cols-2 lg:gap-4">
            {/* Coluna da esquerda: onde o operador age. */}
            <div className={`min-h-0 flex-1 flex-col gap-4 overflow-y-auto ${colunaMobile === 'prontos' ? 'flex' : 'hidden'} lg:flex`}>
            <div className="rounded-menuzia border border-border bg-white">
              <div className="sticky top-0 z-20 flex items-center justify-between bg-status-pending px-4 py-3 text-white">
                <div className="flex items-center gap-2">
                  {unassigned.length > 0 && (
                    <input
                      type="checkbox"
                      checked={unassigned.every((o) => selected.has(o.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(unassigned.map((o) => o.id)) : new Set())}
                      className="h-4 w-4 rounded border-white/60 accent-white"
                    />
                  )}
                  <Package className="h-4 w-4" strokeWidth={2.5} />
                  <h3 className="text-sm font-bold">Prontos para despachar</h3>
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{unassigned.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleDespacho}
                    title={
                      despachoAberto
                        ? 'Fechar o despacho — os entregadores deixam de ver estes pedidos'
                        : 'Liberar os pedidos prontos para os entregadores pegarem no app'
                    }
                    className={`inline-flex items-center gap-1.5 rounded-menuzia px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                      despachoAberto ? 'bg-white text-status-pending hover:bg-white/90' : 'bg-black/20 text-white hover:bg-black/30'
                    }`}
                  >
                    <Bike className="h-4 w-4" /> {despachoAberto ? 'Despacho aberto' : 'Liberar p/ entregadores'}
                  </button>
                {selected.size > 0 && (
                  <div className="relative">
                    <Button variant="dispatch" onClick={() => setBulkAssigning((v) => !v)}>
                      Atribuir {selected.size} selecionado{selected.size > 1 ? 's' : ''}
                    </Button>
                    {bulkAssigning && (
                      <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[240px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
                        {nextaAtivo && (
                          <>
                            {/* Uma corrida por pedido: quem combina entregas é o próprio
                                Nexta (mandamos canCombine), não a gente. */}
                            <OpcaoNexta
                              rotulo={`Nexta — ${selected.size} corrida${selected.size > 1 ? 's' : ''}`}
                              detalhe={
                                totalNextaSelecionado.cotados === 0
                                  ? 'cotando…'
                                  : <>
                                      <span className="font-bold text-price-text">{brl(totalNextaSelecionado.total)}</span>
                                      {totalNextaSelecionado.cotados < selected.size && ` · ${totalNextaSelecionado.cotados} de ${selected.size} cotados`}
                                    </>
                              }
                              onClick={despacharNextaEmLote}
                              disabled={nextaBusy !== null}
                            />
                            <div className="mt-1 border-t border-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                              Meus entregadores
                            </div>
                          </>
                        )}
                        {available.length === 0 && <div className="px-3 py-2 text-xs text-text-subtle">Nenhum entregador disponível</div>}
                        {available.map((driver) => (
                          <button
                            key={driver.id}
                            onClick={() => assignBulk(driver.id)}
                            className="flex w-full items-center justify-between rounded-menuzia px-3 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page"
                          >
                            <span>{driver.nome}</span>
                            <span className="text-xs text-text-subtle">{driver.emRota} em rota</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>
              <div className="border-b border-border px-4 py-2 text-[12px] text-text-subtle">
                Escolha um entregador para cada pedido abaixo.
              </div>
              {despachoAberto && (
                <div className="flex items-center gap-1.5 border-b border-border bg-status-pending/5 px-4 py-2 text-[12px] font-medium text-status-pending">
                  <Bike className="h-3.5 w-3.5 flex-shrink-0" /> Despacho aberto — os entregadores podem pegar estes pedidos pelo app.
                </div>
              )}
              <div className="divide-y divide-border">
                {unassigned.length === 0 && (
                  <div className="flex flex-col items-center gap-1.5 p-8 text-center">
                    <Package className="h-6 w-6 text-border" strokeWidth={2} />
                    <div className="text-sm font-semibold text-text-main">Nenhum pedido aguardando despacho</div>
                    <div className="text-xs text-text-subtle">Assim que a cozinha marcar um pedido como pronto, ele aparece aqui.</div>
                  </div>
                )}
                {unassigned.map((order) => (
                  <div key={order.id} className="flex flex-col gap-3 border-l-[3px] border-l-status-pending bg-status-pending/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                        className="mt-1 h-4 w-4 rounded border-border accent-primary"
                      />
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-bold">#{order.numero}</span>
                          <span className="text-sm font-medium">{order.clienteNome || 'Cliente'}</span>
                          <Badge tone="new">Novo</Badge>
                        </div>
                        <div className="mb-1.5 text-xs text-text-subtle">{endereco(order)}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[order.formaPagamento]}</Badge>
                          {order.formaPagamento === 'dinheiro' && order.trocoPara !== null && (
                            <Badge tone="paused">Troco para {brl(order.trocoPara)}</Badge>
                          )}
                          <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                          {nextaAtivo && <ChipNexta estado={cotacoesNexta[order.id]} />}
                        </div>
                        {/* Voltou pra fila por causa do Nexta: o lojista precisa saber por quê. */}
                        {falhasNexta.has(order.id) && (
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded-menuzia bg-danger-bg px-2 py-1 text-[11px] font-semibold text-danger">
                            <Zap className="h-3 w-3" />
                            {falhasNexta.get(order.id)!.status === 'REJECTED'
                              ? `Nexta recusou: ${motivoRejeicaoTexto(falhasNexta.get(order.id)!.rejeicaoMotivo)}`
                              : 'Corrida do Nexta cancelada'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="relative flex-shrink-0">
                      <Button
                        variant="dispatch"
                        className="min-h-[36px] w-full px-4 text-[12px] sm:w-auto"
                        onClick={(e) => {
                          if (assigning === order.id) {
                            setAssigning(null)
                            return
                          }
                          // Num pedido no fim da coluna rolável o menu abriria pra baixo e
                          // ficaria cortado pela borda, escondendo os entregadores próprios.
                          // Medimos o espaço até o container que corta e viramos pra cima.
                          const btn = e.currentTarget
                          let limiteInferior = window.innerHeight
                          let ancestral: HTMLElement | null = btn.parentElement
                          while (ancestral) {
                            const oy = getComputedStyle(ancestral).overflowY
                            if (oy === 'auto' || oy === 'scroll') {
                              limiteInferior = ancestral.getBoundingClientRect().bottom
                              break
                            }
                            ancestral = ancestral.parentElement
                          }
                          setAssignAcima(limiteInferior - btn.getBoundingClientRect().bottom < ALTURA_MENU_ATRIBUIR)
                          setAssigning(order.id)
                        }}
                      >
                        Atribuir entregador
                      </Button>
                      {assigning === order.id && (
                        <div
                          className={`absolute right-0 z-30 min-w-[240px] rounded-menuzia border border-border bg-white p-1 shadow-xl ${
                            assignAcima ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'
                          }`}
                        >
                          {nextaAtivo && (
                            <>
                              <OpcaoNexta
                                rotulo="Nexta"
                                detalhe={detalheCotacao(cotacoesNexta[order.id])}
                                onClick={() => despacharNexta(order.id)}
                                disabled={nextaBusy !== null}
                              />
                              <div className="mt-1 border-t border-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                                Meus entregadores
                              </div>
                            </>
                          )}
                          {available.length === 0 && <div className="px-3 py-2 text-xs text-text-subtle">Nenhum entregador disponível</div>}
                          {available.map((driver) => (
                            <button
                              key={driver.id}
                              onClick={() => assign(order.id, driver.id)}
                              className="flex w-full items-center justify-between rounded-menuzia px-3 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page"
                            >
                              <span>{driver.nome}</span>
                              <span className="text-xs text-text-subtle">{driver.emRota} em rota</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            </div>

            {/* Coluna da direita: já despachados, só acompanhamento. */}
            <div className={`min-h-0 flex-1 flex-col gap-4 overflow-y-auto ${colunaMobile === 'rota' ? 'flex' : 'hidden'} lg:flex`}>
            {comNexta.length === 0 && inRoute.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 rounded-menuzia border border-dashed border-border bg-white p-8 text-center">
                <Truck className="h-6 w-6 text-border" strokeWidth={2} />
                <div className="text-sm font-semibold text-text-main">Nenhum pedido em rota</div>
                <div className="text-xs text-text-subtle">Os pedidos que você despachar aparecem aqui até serem entregues.</div>
              </div>
            )}

            {/* Com o Nexta: solicitado, ainda não coletado. Depois da coleta vai pra "Em rota". */}
            {nextaAtivo && comNexta.length > 0 && (
              <div className="rounded-menuzia border border-border bg-white">
                <div className="sticky top-0 z-20 flex items-center justify-between bg-primary px-4 py-3 text-white">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" strokeWidth={2.5} />
                    <h3 className="text-sm font-bold">Com o Nexta</h3>
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{comNexta.length}</span>
                  </div>
                  <button
                    onClick={alternarSomNexta}
                    title={somNexta ? 'Desligar o alerta sonoro do Nexta' : 'Ligar o alerta sonoro do Nexta'}
                    className={`inline-flex items-center gap-1.5 rounded-menuzia px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
                      somNexta ? 'bg-white text-primary hover:bg-white/90' : 'bg-black/20 text-white hover:bg-black/30'
                    }`}
                  >
                    {somNexta ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} Som
                  </button>
                </div>
                <div className="border-b border-border px-4 py-2 text-[12px] text-text-subtle">
                  O Nexta já foi chamado e avisado que está pronto para coleta.
                </div>
                <div className="divide-y divide-border">
                  {comNexta.map((order) => {
                    const entrega = nextaPorPedido.get(order.id)!
                    const etapaAtual = TIMELINE_NEXTA.findIndex((e) => e.status === entrega.status)
                    const ocupado = nextaBusy === order.id
                    return (
                      <div key={order.id} className="border-l-[3px] border-l-primary bg-primary/5 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold">#{order.numero}</span>
                              <span className="text-sm font-medium">{order.clienteNome || 'Cliente'}</span>
                              <span className="inline-flex items-center gap-1 rounded-menuzia bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
                                <Zap className="h-3 w-3" /> Nexta
                              </span>
                              <Badge tone="alert">{nextaEventoTexto(entrega.status)}</Badge>
                            </div>
                            <div className="mb-2 text-xs text-text-subtle">{endereco(order)}</div>

                            {/* Timeline compacta: cada etapa acesa até a atual. Etapa
                                desconhecida (enum novo) some com a timeline, não quebra. */}
                            {etapaAtual >= 0 && (
                              <div className="mb-2 flex flex-wrap items-center gap-1">
                                {TIMELINE_NEXTA.map((etapa, i) => (
                                  <span
                                    key={etapa.status}
                                    className={`rounded-menuzia px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                      i <= etapaAtual ? 'bg-primary text-white' : 'bg-page text-text-subtle'
                                    }`}
                                  >
                                    {etapa.label}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[order.formaPagamento]}</Badge>
                              {order.formaPagamento === 'dinheiro' && order.trocoPara !== null && (
                                <Badge tone="paused">Troco para {brl(order.trocoPara)}</Badge>
                              )}
                              <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                              {entrega.preco !== null && (
                                <span className="rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold text-price-text">
                                  Corrida {brl(entrega.preco)}
                                </span>
                              )}
                            </div>

                            {entrega.entregadorNome && (
                              <div className="mt-2.5 flex items-center gap-2">
                                {entrega.entregadorFotoUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={entrega.entregadorFotoUrl} alt={entrega.entregadorNome} className="h-8 w-8 rounded-full border border-border object-cover" />
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white text-xs font-bold text-text-subtle">
                                    {entrega.entregadorNome.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <span className="text-[13px] font-semibold">{entrega.entregadorNome}</span>
                                {entrega.entregadorTelefone && (
                                  <a href={`tel:${entrega.entregadorTelefone}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                                    <Phone className="h-3.5 w-3.5" /> {entrega.entregadorTelefone}
                                  </a>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-shrink-0 flex-wrap gap-2">
                            <Button variant="outline" onClick={() => reconciliarNexta(order.id)} disabled={ocupado} title="Buscar o status atual no Nexta">
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <a
                              href={NEXTA_PAINEL_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir o painel do Nexta (código de coleta, ocorrências etc.)"
                              className="inline-flex items-center justify-center gap-1.5 rounded-menuzia border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Nexta
                            </a>
                            {entrega.trackingUrl && (
                              <a
                                href={entrega.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 rounded-menuzia border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:border-primary hover:text-primary"
                              >
                                Rastrear
                              </a>
                            )}
                            <Button variant="ghost" className="text-danger hover:bg-danger-bg" onClick={() => setCancelandoNexta(order.id)} disabled={ocupado}>
                              Cancelar
                            </Button>
                          </div>
                        </div>

                        {cancelandoNexta === order.id && (
                          <div className="mt-3 rounded-menuzia border border-danger bg-danger-bg p-3">
                            <p className="mb-2.5 text-[12px] font-medium text-danger">
                              Cancelar a corrida do pedido #{order.numero} no Nexta? Dependendo do estágio, o Nexta pode cobrar pelo
                              cancelamento — avisamos aqui se houver cobrança. O pedido volta para a fila de despacho.
                            </p>
                            <div className="flex gap-2">
                              <Button variant="secondary" onClick={() => setCancelandoNexta(null)}>
                                Voltar
                              </Button>
                              <Button variant="outline" className="border-danger text-danger hover:bg-white" onClick={() => cancelarNexta(order.id)} disabled={ocupado}>
                                {ocupado ? 'Cancelando…' : 'Cancelar corrida'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {inRoute.length > 0 && (
            <div className="rounded-menuzia border border-border bg-white">
              <div className="sticky top-0 z-20 flex items-center justify-between bg-status-preparing px-4 py-3 text-white">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4" strokeWidth={2.5} />
                  <h3 className="text-sm font-bold">Em rota</h3>
                </div>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{inRoute.length}</span>
              </div>
              <div className="border-b border-border px-4 py-2 text-[12px] text-text-subtle">
                Já saíram com o entregador. Marque como entregue quando o cliente receber.
              </div>
              <div className="divide-y divide-border">
                {inRoute.map((order) => (
                  <div
                    key={order.id}
                    className="flex flex-col gap-2 border-l-[3px] border-l-status-preparing bg-status-preparing/5 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">#{order.numero}</span>
                        <span className="text-sm font-medium">{order.clienteNome || 'Cliente'}</span>
                        <Badge tone="preparing">Saiu para entrega</Badge>
                        <ArrowRight className="h-4 w-4 text-status-preparing" strokeWidth={2.5} />
                        {/* Entrega do Nexta não tem entregador próprio: quem aparece é o
                            motoboy que o webhook informou. */}
                        {nextaPorPedido.has(order.id) ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary">
                            <Zap className="h-3.5 w-3.5" /> Nexta
                            {nextaPorPedido.get(order.id)!.entregadorNome && ` · ${nextaPorPedido.get(order.id)!.entregadorNome}`}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-status-preparing/10 px-2 py-0.5 text-[12px] font-semibold text-status-preparing">
                            <Bike className="h-3.5 w-3.5" /> {driverName(order.entregadorId)}
                          </span>
                        )}
                      </div>
                      <div className="mb-1.5 text-xs text-text-subtle">{endereco(order)}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[order.formaPagamento]}</Badge>
                        {order.formaPagamento === 'dinheiro' && order.trocoPara !== null && (
                          <Badge tone="paused">Troco para {brl(order.trocoPara)}</Badge>
                        )}
                        <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 gap-2">
                      <Button variant="success" className="min-h-[36px] flex-1 px-4 text-[12px] sm:flex-none" onClick={() => deliver(order.id)}>
                        Entregue
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-[36px] border-danger text-danger hover:bg-danger-bg"
                        onClick={() => naoEntregue(order.id)}
                      >
                        Não entregue
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            )}
            </div>
            </div>
            </>
            )}

            {tab === 'concluidos' && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-menuzia border border-border bg-white">
              <div className="sticky top-0 z-20 flex items-center justify-between bg-text-main px-4 py-3 text-white">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4" strokeWidth={2.5} />
                  <h3 className="text-sm font-bold">Pedidos do dia</h3>
                </div>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">
                  {filtrosAtivos ? `${concluidosFiltrados.length} de ${concluidos.length}` : concluidos.length}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <input
                  value={filtroBusca}
                  onChange={(e) => setFiltroBusca(e.target.value)}
                  placeholder="Buscar por cliente ou bairro"
                  className="min-w-[180px] flex-1 rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                />
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                  className="rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                >
                  <option value="todos">Todos os status</option>
                  <option value="entregue">Concluído</option>
                  <option value="cancelado">Cancelado</option>
                </select>
                <input
                  value={filtroValorMin}
                  onChange={(e) => setFiltroValorMin(e.target.value)}
                  placeholder="Valor mín."
                  inputMode="decimal"
                  className="w-24 rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                />
                <input
                  value={filtroValorMax}
                  onChange={(e) => setFiltroValorMax(e.target.value)}
                  placeholder="Valor máx."
                  inputMode="decimal"
                  className="w-24 rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                />
                {filtrosAtivos && (
                  <button onClick={limparFiltros} className="text-xs font-semibold text-text-subtle hover:text-text-main">
                    Limpar filtros
                  </button>
                )}
              </div>
              <div className="divide-y divide-border">
                {concluidos.length === 0 && <div className="p-6 text-center text-sm text-text-subtle">Nenhum pedido finalizado hoje</div>}
                {concluidos.length > 0 && concluidosFiltrados.length === 0 && (
                  <div className="p-6 text-center text-sm text-text-subtle">Nenhum pedido encontrado com esses filtros</div>
                )}
                {concluidosFiltrados.map((order) => {
                  const entregue = order.status === 'entregue'
                  return (
                    <div
                      key={order.id}
                      className={`flex flex-col gap-2 border-l-[3px] p-4 sm:flex-row sm:items-center sm:justify-between ${
                        entregue ? 'border-l-status-ready bg-status-ready/5' : 'border-l-danger bg-danger/5'
                      }`}
                    >
                      <div>
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-bold">#{order.numero}</span>
                          <span className="text-sm font-medium">{order.clienteNome || 'Cliente'}</span>
                          <Badge tone={order.tipo === 'entrega' ? 'alert' : 'paused'}>{order.tipo === 'entrega' ? 'Entrega' : 'Retirada'}</Badge>
                          <Badge tone={entregue ? 'ok' : 'danger'}>{entregue ? 'Concluído' : 'Cancelado'}</Badge>
                        </div>
                        <div className="text-xs text-text-subtle">
                          {order.tipo === 'entrega' ? (
                            <>{endereco(order)} · entregador: <b className="text-text-main">{driverName(order.entregadorId)}</b></>
                          ) : (
                            'Retirada no balcão'
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={order.formaPagamento === 'dinheiro' ? 'pending' : 'alert'}>{PAY_LABEL[order.formaPagamento]}</Badge>
                        <span className="text-sm font-bold text-price-text">{brl(order.total)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            )}
          </section>
          )}
        </div>
      </div>

      {/* Fechamento de caixa */}
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
            <p className="mt-0.5 text-xs text-text-subtle">Conferência entre o dinheiro esperado e o declarado por entregador.</p>
          </div>
          <button onClick={() => setClosingOpen(false)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <p className="mb-4 text-xs leading-relaxed text-text-subtle">
            Valor esperado = soma dos pedidos pagos em dinheiro (em rota + entregues) de cada entregador. Informe o valor declarado ao
            final da rota para registrar a diferença.
          </p>
          {resumo.length === 0 && (
            <div className="rounded-menuzia border border-dashed border-border p-4 text-center text-xs text-text-subtle">
              Nenhum pedido em dinheiro atribuído a entregadores ainda.
            </div>
          )}
          {resumo.map((r) => {
            const valor = Number((declarado[r.entregadorId] ?? '').replace(/\./g, '').replace(',', '.'))
            const diff = Number.isFinite(valor) && (declarado[r.entregadorId] ?? '') !== '' ? valor - r.valorEsperado : null
            return (
              <div key={r.entregadorId} className="mb-3 rounded-menuzia border border-border p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold">{r.nome}</h4>
                  <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle">{r.pedidos} pedido(s)</span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-text-subtle">Valor esperado</span><span className="font-medium">{brl(r.valorEsperado)}</span></div>
                  <div className="flex justify-between"><span className="text-text-subtle">Troco levado</span><span className="font-medium">{brl(r.trocoLevado)}</span></div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-text-subtle">Valor declarado</span>
                    <input
                      value={declarado[r.entregadorId] ?? ''}
                      onChange={(e) => setDeclarado((prev) => ({ ...prev, [r.entregadorId]: e.target.value }))}
                      placeholder="0,00"
                      className="w-28 rounded-menuzia border border-border px-2.5 py-1.5 text-right font-sans text-[13px] outline-none focus:border-primary"
                    />
                  </div>
                  {diff !== null && (
                    <div className="flex justify-between border-t border-border pt-1.5 font-bold">
                      <span>Diferença</span>
                      <span className={diff === 0 ? 'text-price-text' : 'text-danger'}>{diff < 0 ? '− ' : ''}{brl(Math.abs(diff))}</span>
                    </div>
                  )}
                </div>
                <Button variant="primary" className="mt-3 w-full" onClick={() => saveClosing(r)} disabled={(declarado[r.entregadorId] ?? '') === ''}>
                  Registrar fechamento
                </Button>
              </div>
            )
          })}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={() => setClosingOpen(false)}>
            Fechar
          </Button>
        </div>
      </aside>

      {/* Acesso do entregador (link/QR) */}
      {linkDriver && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setLinkDriver(null)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[380px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          linkDriver ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Acesso do entregador</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{linkDriver?.nome}</p>
          </div>
          <button onClick={() => setLinkDriver(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <p className="mb-4 text-xs leading-relaxed text-text-subtle">
            Compartilhe esse QR code ou link com {linkDriver?.nome}. Ao abrir, o painel de entregas dele aparece direto — sem precisar
            de login ou senha.
          </p>
          {qrDataUrl && (
            <div className="mb-4 flex items-center justify-center rounded-menuzia border border-border p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR code de acesso do entregador" className="h-[240px] w-[240px]" />
            </div>
          )}
          {linkDriver && (
            <div className="mb-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Link de acesso</div>
              <div className="break-all rounded-menuzia border border-border bg-page px-2.5 py-2 text-[12px] text-text-main">{portalUrl(linkDriver)}</div>
            </div>
          )}
          <Button variant="primary" className="w-full" onClick={copiarLink}>
            {linkCopied ? 'Link copiado!' : 'Copiar link'}
          </Button>
        </div>
      </aside>

      {/* Localização do entregador */}
      {locationDriver && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/55 p-4" onClick={() => setLocationDriverId(null)}>
          <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-bold">Localização — {locationDriver.nome}</h2>
                {locationDriver.localizacao && (
                  <p className="mt-0.5 text-xs text-text-subtle">Atualizado {tempoRelativo(locationDriver.localizacao.atualizadaEm)}</p>
                )}
              </div>
              <button onClick={() => setLocationDriverId(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 p-4.5">
              {locationDriver.localizacao ? (
                <RouteMap
                  apiKey={MAPS_KEY}
                  origin={{ lat: locationDriver.localizacao.lat, lng: locationDriver.localizacao.lng }}
                  stops={locationDriverStops}
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-menuzia border border-dashed border-border p-8 text-center text-sm text-text-subtle">
                  Localização ainda não disponível. O motoboy precisa abrir o link de acesso e permitir a localização no celular.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Perfil do entregador */}
      {profileDriverId && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setProfileDriverId(null)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[380px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          profileDriverId ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Perfil do entregador</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{profileDriver?.nome}</p>
          </div>
          <button onClick={() => setProfileDriverId(null)} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {perfilError && (
            <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{perfilError}</div>
          )}
          <div className="mb-4 flex items-center gap-3">
            {perfilForm.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={perfilForm.fotoUrl} alt="Foto do entregador" className="h-16 w-16 rounded-menuzia border border-border object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-bold text-text-subtle">
                {perfilForm.nome.trim().charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <input ref={fotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleFotoPick} />
            <div className="flex flex-col gap-1.5">
              <Button variant="outline" type="button" onClick={() => fotoInputRef.current?.click()} disabled={uploadingFoto}>
                {uploadingFoto ? 'Enviando…' : perfilForm.fotoUrl ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              {perfilForm.fotoUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setPerfilForm((f) => ({ ...f, fotoUrl: '' }))
                    setPerfilSaved(false)
                  }}
                  className="text-[12px] text-text-subtle hover:text-danger"
                >
                  Remover
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome</label>
              <input
                value={perfilForm.nome}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, nome: e.target.value }))
                  setPerfilSaved(false)
                }}
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Telefone</label>
              <input
                value={perfilForm.telefone}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, telefone: e.target.value }))
                  setPerfilSaved(false)
                }}
                placeholder="(00) 00000-0000"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Veículo</label>
              <input
                value={perfilForm.veiculo}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, veiculo: e.target.value }))
                  setPerfilSaved(false)
                }}
                placeholder="Ex: Honda CG 160"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Placa</label>
              <input
                value={perfilForm.placa}
                onChange={(e) => {
                  setPerfilForm((f) => ({ ...f, placa: e.target.value.toUpperCase() }))
                  setPerfilSaved(false)
                }}
                placeholder="ABC-1234"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-4.5 py-3">
          {perfilSaved && !perfilSaving ? (
            <span className="text-[13px] font-medium text-status-ready">Alterações salvas.</span>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={savePerfil} disabled={perfilSaving || !perfilForm.nome.trim()}>
            {perfilSaving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </aside>
    </>
  )
}
