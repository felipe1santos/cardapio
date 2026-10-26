'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { aplicarEventoEntregador } from '@/lib/entregadores-evento'
import { Bike, ChevronDown, ChevronUp } from 'lucide-react'
import { avisoDePedidosParados } from '@/lib/pedido-parado'
import { TopBar } from '@/components/layout/topbar'
import { ICONES } from '@/lib/icones-painel'
import { mascararTelefoneBR, telefoneCompleto } from '@/lib/telefone'
import { Button } from '@/components/ui/button'
import { RouteMap } from '@/components/maps/route-map'
import { buscarLojaNoMapa, type LojaDoMapa } from '@/lib/maps/loja-mapa'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { notificarPedido } from '@/lib/notificar'
import {
  atualizarPerfilEntregador,
  criarEntregador,
  definirStatusEntregador,
  enderecoCompletoPedido,
  enviarFotoEntregador,
  listarEntregadores,
  listarPedidosConcluidos,
  listarPedidosLogistica,
  entregarPedidoEmRota,
  type Entregador,
  type Pedido,
  type StatusEntregador,
} from '@/lib/queries/pedidos'
import { cancelarPedidoRequest } from '@/lib/cancelamento'
import { CaixaTurnoGaveta } from '@/components/logistica/caixa-turno'
import { DinheiroComMotoboys } from '@/components/logistica/motoboy-financeiro'
import { AcessoMotoboy } from '@/components/logistica/acesso-motoboy'
import { buscarFluxoLoja } from '@/lib/queries/ajustes'
import { formatarReal } from '@/lib/moeda'
import { PainelPedido } from '@/components/pedidos/painel-pedido'
import { solicitarReimpressao } from '@/lib/queries/impressao'
import { useCoordenadasPedidos } from '@/lib/mapa/cliente'
import { EmRotaNovo, FinalizadosNovo, ListaEntregadoresNovo } from '@/components/logistica/pedidos-novo'
import { CarregandoPagina } from '@/components/admin/barra-carregamento'
import { contarOnline } from '@/lib/motoboy/status-real'
import { AvisoTopo, LinhaResumos } from '@/components/ui/topo-compacto'

type Tab = 'pedidos' | 'entregadores'
type Periodo = 'hoje' | 'ontem' | '7dias' | 'personalizado'

/** Chave do localStorage que lembra se o operador recolheu os cards de resumo. */
const RESUMO_KEY = 'menuzia:logistica:resumo'

const TABS: { id: Tab; label: string }[] = [
  { id: 'pedidos', label: 'Pedidos' },
  { id: 'entregadores', label: 'Entregadores' },
]

/**
 * Aba do query param (`?tab=`), pra deep-link e pra não perder o lugar num refresh.
 * Lida só depois da montagem — ler `window` no estado inicial quebraria a hidratação.
 */
function tabDaUrl(): Tab | null {
  const valor = new URLSearchParams(window.location.search).get('tab')
  // Links antigos da Logística (?tab=despacho / ?tab=concluidos) caem na aba Pedidos.
  if (valor === 'entregadores') return 'entregadores'
  return valor ? 'pedidos' : null
}

function inicioDoDiaISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

/** Período da lista de finalizados (item 58): [desde, até) no horário local. */
function intervaloDoPeriodo(p: Periodo, de: string, ate: string): { desde: string; ate?: string } | null {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const dia = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() + n); return d.toISOString() }
  if (p === 'hoje') return { desde: dia(0) }
  if (p === 'ontem') return { desde: dia(-1), ate: dia(0) }
  if (p === '7dias') return { desde: dia(-6) }
  if (!de) return null
  const ini = new Date(`${de}T00:00:00`)
  const fim = ate ? new Date(`${ate}T00:00:00`) : new Date(ini)
  fim.setDate(fim.getDate() + 1)
  return Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime()) ? null : { desde: ini.toISOString(), ate: fim.toISOString() }
}
const ROTULO_PERIODO: Record<Periodo, string> = { hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias', personalizado: 'Personalizado' }

// Milhar com ponto ("R$ 4.088,00"): função única do painel, ver lib/moeda.ts.
const brl = formatarReal


const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

function tempoRelativo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora mesmo'
  if (min === 1) return 'há 1 min'
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)}h`
}


/* ── Peças da tela ─────────────────────────────────────────────────────────
   Mesmo vocabulário do Dashboard: cartão branco de borda fina, cabeçalho
   branco com ícone em bolha colorida (a cor diz o assunto, não pinta o bloco
   inteiro) e estados vazios com uma frase que diz o que fazer. */

/** Foto do entregador ou a inicial num círculo com cor estável pelo nome. */
const CORES_AVATAR = ['#A855F7', '#F97316', '#10B981', '#3B82F6', '#F59E0B', '#EF4444']
function Avatar({ nome, fotoUrl, tamanho = 40 }: { nome: string; fotoUrl: string | null; tamanho?: number }) {
  if (fotoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fotoUrl}
        alt={nome}
        loading="lazy"
        decoding="async"
        width={tamanho}
        height={tamanho}
        className="flex-shrink-0 rounded-full border border-[var(--adm-borda)] object-cover"
        style={{ width: tamanho, height: tamanho }}
      />
    )
  }
  const cor = CORES_AVATAR[[...nome].reduce((s, c) => s + c.charCodeAt(0), 0) % CORES_AVATAR.length]
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: tamanho, height: tamanho, backgroundColor: cor, fontSize: Math.round(tamanho * 0.42) }}
      aria-hidden="true"
    >
      {nome.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

const CLASSE_CAMPO =
  'h-[38px] w-full rounded-[4px] border border-[var(--adm-borda)] bg-white px-2.5 font-sans text-[13px] outline-none transition-colors focus:border-[var(--adm-azul)]'

function CampoEntregador({ rotulo, obrigatorio, dica, children }: { rotulo: string; obrigatorio?: boolean; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-[var(--adm-texto-forte)]">
        {rotulo}
        {obrigatorio && <span className="text-danger"> *</span>}
      </span>
      {children}
      {dica && <span className="mt-1 block text-[11px] text-[var(--adm-texto-suave)]">{dica}</span>}
    </label>
  )
}

/**
 * "Pedidos" (item 58, antes "Logística"): indicadores do dia, a lista de pedidos finalizados
 * (entregues, retirados e cancelados) com busca, status, valor e período, e o detalhe ao clicar;
 * "Em rota agora" (marcar entregue / não entregue) e a aba Entregadores de sempre. O
 * despacho saiu daqui para o Kanban (botão "Despachar" e despacho pelo card).
 */
export default function PedidosFinalizadosPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  // Visual (14/10; todas as lojas desde 16/10): components/logistica/pedidos-novo.
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  // Onde a loja fica: o mapa do entregador abre nela (antes: Fortaleza fixo até a rota chegar).
  const [lojaMapa, setLojaMapa] = useState<LojaDoMapa>('carregando')
  useEffect(() => {
    if (!restauranteId) return
    let vivo = true
    void buscarLojaNoMapa(supabase, restauranteId).then((l) => { if (vivo) setLojaMapa(l) }).catch(() => { if (vivo) setLojaMapa(null) })
    return () => { vivo = false }
  }, [supabase, restauranteId])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [orders, setOrders] = useState<Pedido[]>([])
  const [concluidos, setConcluidos] = useState<Pedido[]>([])
  const [drivers, setDrivers] = useState<Entregador[]>([])
  const driversRef = useRef<Entregador[]>([])
  driversRef.current = drivers
  const [closingOpen, setClosingOpen] = useState(false)

  const [linkDriver, setLinkDriver] = useState<Entregador | null>(null)
  const [credencialNova, setCredencialNova] = useState<{ id: string; usuario: string; senha: string } | null>(null)
  const [locationDriverId, setLocationDriverId] = useState<string | null>(null)
  const [profileDriverId, setProfileDriverId] = useState<string | null>(null)
  const [perfilForm, setPerfilForm] = useState({ nome: '', telefone: '', veiculo: '', placa: '', fotoUrl: '' })
  const [perfilSaving, setPerfilSaving] = useState(false)
  const [perfilSaved, setPerfilSaved] = useState(false)
  const [perfilError, setPerfilError] = useState<string | null>(null)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<Tab>('pedidos')
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [periodoDe, setPeriodoDe] = useState('')
  const [periodoAte, setPeriodoAte] = useState('')
  const [lista, setLista] = useState<Pedido[]>([])
  const [carregandoLista, setCarregandoLista] = useState(false)
  const [detalhe, setDetalhe] = useState<Pedido | null>(null)
  const [editandoPag, setEditandoPag] = useState(false)
  const [reimpEstado, setReimpEstado] = useState<'idle' | 'enviando' | 'ok' | 'erro'>('idle')
  // Começa visível sempre: o valor salvo só entra depois da montagem, senão o primeiro
  // render do servidor e o do cliente divergem e a hidratação quebra.
  const [resumoVisivel, setResumoVisivel] = useState(true)

  const [filtroBusca, setFiltroBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'entregue' | 'cancelado'>('todos')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')

  const [novoDriver, setNovoDriver] = useState({ nome: '', telefone: '', veiculo: '', placa: '' })
  const [statusMudando, setStatusMudando] = useState<string | null>(null)
  // Entrega sem entregador (0079). null enquanto a config não chegou.
  const [semEntregador, setSemEntregador] = useState<boolean | null>(null)
  const [addingDriver, setAddingDriver] = useState(false)
  const [addDriverOpen, setAddDriverOpen] = useState(false)



  const refetchAgora = useCallback(
    async (id: string) => {
      try {
        const [pedidos, entregadores, finalizados] = await Promise.all([
          listarPedidosLogistica(supabase, id),
          listarEntregadores(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
        ])
        setOrders(pedidos)
        setDrivers(entregadores)
        setConcluidos(finalizados)
      } catch {
        setError('Não foi possível carregar a logística.')
      }
    },
    [supabase]
  )

  // Rajada de eventos (heartbeat de cada motoboy a 30s, a própria
  // atribuição) disparava uma recarga completa por evento, várias ao mesmo tempo — a
  // tela ficava lenta. Agora roda no máximo uma por vez e junta o que chegar no meio
  // numa única recarga ao final.
  const recarregando = useRef(false)
  const recargaPendente = useRef<string | null>(null)
  const refetch = useCallback(
    async (id: string): Promise<void> => {
      if (recarregando.current) {
        recargaPendente.current = id
        return
      }
      recarregando.current = true
      try {
        await refetchAgora(id)
      } finally {
        recarregando.current = false
        const proxima = recargaPendente.current
        recargaPendente.current = null
        if (proxima) void refetch(proxima)
      }
    },
    [refetchAgora]
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
      await Promise.all([
        refetch(id),
        buscarFluxoLoja(supabase, id)
          .then((f) => active && setSemEntregador(f.entregaSemEntregador))
          .catch(() => active && setSemEntregador(false)),
      ])
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [supabase, refetch])

  // Canal Realtime num effect próprio: o cleanup retornado por uma função
  // async nunca é chamado pelo React, então o canal ficava aberto pra sempre
  // a cada remontagem da página, vazando conexões Realtime ao longo do turno.
  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: restauranteId ? `logistica-${restauranteId}` : null,
    tabelas: useMemo(() => {
      const filtro = restauranteId ? `restaurante_id=eq.${restauranteId}` : undefined
      return [{ tabela: 'pedidos', filtro }, { tabela: 'entregadores', filtro }]
    }, [restauranteId]),
    aoEvento: useCallback((payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
      if (!restauranteId) return
      // Heartbeat do motoboy (achado #7): aplica na linha dele, sem reler pedidos e concluídos.
      if (payload.table === 'entregadores') {
        const r = aplicarEventoEntregador(driversRef.current, payload)
        if (!r.recarregar) { driversRef.current = r.lista; setDrivers(r.lista); return }
      }
      refetch(restauranteId)
    }, [refetch, restauranteId]),
    aoSincronizar: useCallback(() => { if (restauranteId) refetch(restauranteId) }, [refetch, restauranteId]),
  })

  useEffect(() => {
    const inicial = tabDaUrl()
    if (inicial) setTab(inicial)
  }, [])

  function irParaTab(proxima: Tab) {
    setTab(proxima)
    const url = new URL(window.location.href)
    if (proxima === 'pedidos') url.searchParams.delete('tab')
    else url.searchParams.set('tab', proxima)
    // replaceState em vez de router.push: trocar de aba não merece entrada no histórico
    // e não pode remontar a página (mataria o realtime).
    window.history.replaceState(null, '', url)
  }

  // Refetch periódico — "motoboy online" depende do horário atual, então precisa
  // recalcular mesmo sem eventos de realtime (ex.: motoboy fechou o app). Com o
  // canal saudável vira heartbeat; se ele cair, volta ao ritmo agressivo.
  useEffect(() => {
    if (!restauranteId) return
    const interval = setInterval(() => refetch(restauranteId), intervaloMs)
    return () => clearInterval(interval)
  }, [restauranteId, refetch, intervaloMs])

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, periodoDe, periodoAte), [periodo, periodoDe, periodoAte])
  useEffect(() => {
    if (!restauranteId) return
    if (periodo === 'hoje') { setLista(concluidos); return }
    if (!intervalo) { setLista([]); return }
    let vivo = true
    setCarregandoLista(true)
    listarPedidosConcluidos(supabase, restauranteId, intervalo.desde, intervalo.ate)
      .then((l) => { if (vivo) setLista(l) })
      .catch(() => { if (vivo) setError('Não foi possível carregar os pedidos do período.') })
      .finally(() => { if (vivo) setCarregandoLista(false) })
    return () => { vivo = false }
  }, [supabase, restauranteId, periodo, intervalo, concluidos])
  useEffect(() => { setReimpEstado('idle'); setEditandoPag(false) }, [detalhe?.id])

  const inRoute = orders.filter((o) => o.status === 'em_rota')
  // Pedido aberto há mais de 12h: um dia alguém não marcou "entregue" e ele ficou.
  const avisoParados = avisoDePedidosParados(orders, Date.now())

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

  const locationDriver = drivers.find((d) => d.id === locationDriverId) ?? null
  const profileDriver = drivers.find((d) => d.id === profileDriverId) ?? null
  // Mapa da localização: coordenadas pelo servidor (gravadas no pedido), uma vez por pedido; o navegador nunca
  // geocodifica (docs/REGRAS-DE-CUSTO.md). Tudo memorizado: o mapa não re-renderiza com a página.
  const locationPedidos = useMemo(
    () => (locationDriver ? orders.filter((o) => o.entregadorId === locationDriver.id && o.status === 'em_rota') : []),
    [locationDriver, orders]
  )
  const locationCoords = useCoordenadasPedidos(useMemo(() => locationPedidos.map((o) => o.id), [locationPedidos]))
  const locationDriverStops = useMemo(() => locationPedidos.map((o, i) => {
    const c = locationCoords.get(o.id) ?? null
    return { id: o.id, numero: i + 1, address: enderecoCompletoPedido(o), lat: c?.lat ?? null, lng: c?.lng ?? null }
  }), [locationPedidos, locationCoords])
  const locationOrigem = useMemo(
    () => (locationDriver?.localizacao ? { lat: locationDriver.localizacao.lat, lng: locationDriver.localizacao.lng } : null),
    [locationDriver?.localizacao?.lat, locationDriver?.localizacao?.lng] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const concluidosFiltrados = useMemo(() => {
    const busca = filtroBusca.trim().toLowerCase()
    const min = filtroValorMin.trim() === '' ? null : Number(filtroValorMin.replace(/\./g, '').replace(',', '.'))
    const max = filtroValorMax.trim() === '' ? null : Number(filtroValorMax.replace(/\./g, '').replace(',', '.'))
    return lista.filter((o) => {
      if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false
      if (busca && !(o.clienteNome.toLowerCase().includes(busca) || o.enderecoBairro.toLowerCase().includes(busca))) return false
      if (min !== null && Number.isFinite(min) && o.total < min) return false
      if (max !== null && Number.isFinite(max) && o.total > max) return false
      return true
    })
  }, [lista, filtroBusca, filtroStatus, filtroValorMin, filtroValorMax])

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

  async function deliver(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      // Já entregue pelo entregador: não avisa o cliente de novo.
      if (await entregarPedidoEmRota(supabase, orderId)) notificarPedido(orderId, 'entregue')
      if (restauranteId) refetch(restauranteId)
    } catch {
      setError('Não foi possível marcar como entregue.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  async function naoEntregue(orderId: string) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId))
    try {
      await cancelarPedidoRequest(orderId, 'nao_entregue', '')
      notificarPedido(orderId, 'cancelado')
      if (restauranteId) refetch(restauranteId)
    } catch {
      setError('Não foi possível marcar como não entregue.')
      if (restauranteId) refetch(restauranteId)
    }
  }

  function abrirNovoEntregador() {
    setNovoDriver({ nome: '', telefone: '', veiculo: '', placa: '' })
    setAddDriverOpen(true)
  }

  async function addDriver() {
    if (!restauranteId || !novoDriver.nome.trim()) return
    setAddingDriver(true)
    try {
      const nome = novoDriver.nome.trim()
      const telefone = novoDriver.telefone.trim()
      const veiculo = novoDriver.veiculo.trim()
      const placa = novoDriver.placa.trim()
      const criado = await criarEntregador(supabase, restauranteId, nome, telefone, { veiculo, placa })
      // Equipe = Entregadores (10/10): já cria o login do app (aparece na Equipe como Motoboy); a senha aparece uma vez no Acesso.
      const rl = await fetch(`/api/admin/entregadores/${criado.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'criar_login' }) }).catch(() => null)
      const jl = rl?.ok ? ((await rl.json().catch(() => null)) as { usuario?: string; senha?: string } | null) : null
      setCredencialNova(jl?.usuario && jl.senha ? { id: criado.id, usuario: jl.usuario, senha: jl.senha } : null)
      setAddDriverOpen(false)
      await refetch(restauranteId)
      // Próximo passo natural: mandar o acesso pro motoboy.
      setLinkDriver({
        id: criado.id,
        token: criado.token,
        nome,
        telefone,
        veiculo,
        placa,
        status: 'online',
        emRota: 0,
        online: false,
        localizacao: null,
        fotoUrl: null,
      })
    } catch {
      setError('Não foi possível cadastrar o entregador.')
    } finally {
      setAddingDriver(false)
    }
  }

  async function mudarStatus(id: string, status: StatusEntregador) {
    setStatusMudando(id)
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)))
    try {
      await definirStatusEntregador(supabase, id, status)
    } catch {
      setError('Não foi possível mudar a situação do entregador.')
      if (restauranteId) refetch(restauranteId)
    } finally {
      setStatusMudando(null)
    }
  }

  // Turno de caixa (0114): a gaveta carrega e grava pela /api/admin/caixa.
  function openClosing() {
    setClosingOpen(true)
  }

  if (loading) {
    return (
      <>
        <TopBar title="Pedidos" breadcrumb="Pedidos finalizados e entregadores" />
        <CarregandoPagina />
      </>
    )
  }

  const entreguesHoje = concluidos.filter((o) => o.status === 'entregue')
  const onlineAgora = contarOnline(drivers)
  return (
    <>
      {/* Topo compacto (16/10): o aviso de pedido parado vai para a barra do topo (texto inteiro no "i"). */}
      <TopBar title="Pedidos" breadcrumb="Pedidos finalizados e entregadores"
        aviso={avisoParados ? <AvisoTopo testid="aviso-pedidos-parados" texto={avisoParados} info={{ titulo: 'Pedido parado', conteudo: avisoParados }} /> : undefined} />

      <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {semEntregador && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 rounded-[6px] border-[0.8px] border-[#fcd34d] bg-warn-bg px-3 py-1.5 text-[12.5px] text-[#92400E]" data-testid="aviso-sem-entregador">
            <Bike className="h-4 w-4 flex-shrink-0" /> A loja entrega <b>sem entregador</b>: o pedido sai pelo Painel de Pedidos (“Saiu p/ entrega”). Para voltar a usar entregadores: Painel de Pedidos › ⋯.
          </div>
        )}
        {error && (
          <div className="flex flex-shrink-0 items-center justify-between gap-3 rounded-[6px] border-[0.8px] border-danger bg-danger-bg px-3.5 py-2.5 text-[12.8px] font-semibold text-danger">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-[12px] font-semibold underline-offset-2 hover:underline">
              Dispensar
            </button>
          </div>
        )}

        {/* Entrega que ninguém fechou fica aqui para sempre e some do acompanhamento do
            cliente. O sistema não encerra nada sozinho — cobra (lib/pedido-parado.ts). */}

        {/* Abas em linha, sublinhado na cor de marca — o mesmo desenho das tabelas
            do Dashboard, sem o bloco vermelho de antes. */}
        <div className="flex flex-shrink-0 items-end justify-between gap-3 border-b border-[var(--adm-borda)] max-md:flex-wrap max-md:gap-y-1">
          <div className="flex gap-1 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden" role="tablist">
            {TABS.map((t) => {
              const contador = t.id === 'pedidos' ? lista.length : drivers.length
              const ativa = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={ativa}
                  onClick={() => irParaTab(t.id)}
                  className={[
                    '-mb-px flex flex-shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 pb-2.5 pt-1.5 text-[13.5px] transition-colors',
                    ativa
                      ? 'border-[var(--adm-azul)] font-semibold text-[var(--adm-texto)]'
                      : 'border-transparent font-medium text-[var(--adm-texto-suave)] hover:text-[var(--adm-texto)]',
                  ].join(' ')}
                >
                  {t.label}
                  {contador > 0 && (
                    <span
                      className={`min-w-[20px] rounded-full px-1.5 py-[1px] text-center text-[11px] font-semibold ${
                        ativa ? 'bg-[var(--adm-azul)] text-white' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'
                      }`}
                    >
                      {contador}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="mb-1.5 flex min-w-0 flex-shrink items-center gap-2 max-md:basis-full">
          {/* Resumo numa linha ao lado das abas (16/10; antes eram 3 cartões grandes). */}
          {resumoVisivel && (
            <div className="min-w-0 max-md:w-full" data-testid="indicadores-pedidos">
              <LinhaResumos itens={[
                { rotulo: 'Entregues hoje', valor: <>{entreguesHoje.length} <span className="font-normal text-[var(--adm-texto-suave)]">· {brl(entreguesHoje.reduce((s, o) => s + o.total, 0))}</span></>, icone: ICONES.concluido, tom: 'verde', testid: 'resumo-entregues' },
                { rotulo: 'Em rota agora', valor: inRoute.length, icone: ICONES.logistica, tom: 'roxo', testid: 'resumo-em-rota', dica: 'com seus entregadores' },
                { rotulo: 'Online agora', valor: <>{onlineAgora.online} <span className="font-normal text-[var(--adm-texto-suave)]">de {onlineAgora.total}</span></>, icone: ICONES.entregador, tom: 'azul', testid: 'resumo-online', dica: 'com o app aberto' },
              ]} />
            </div>
          )}
          <button
            onClick={alternarResumo}
            className="hidden flex-shrink-0 items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] font-medium text-[var(--adm-texto-suave)] transition-colors hover:bg-[var(--adm-hover)] hover:text-[var(--adm-texto)] sm:inline-flex"
          >
            {resumoVisivel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {resumoVisivel ? 'Ocultar resumo' : 'Mostrar resumo'}
          </button>
          </div>
        </div>

        {/* Financeiro (0136): dinheiro com cada motoboy e troco a entregar no despacho. Só com o módulo ligado. */}
        <DinheiroComMotoboys compacto />
        <div className="flex flex-col">
          {/* Entregadores */}
          {tab === 'entregadores' && (
            <ListaEntregadoresNovo
              drivers={drivers}
              emRota={inRoute}
              agora={Date.now()}
              statusMudando={statusMudando}
              onStatus={mudarStatus}
              onPerfil={setProfileDriverId}
              onLocalizacao={setLocationDriverId}
              onAcesso={setLinkDriver}
              onNovo={abrirNovoEntregador}
              onFechamento={openClosing}
            />
          )}

          {/* Pedidos */}
          {tab !== 'entregadores' && (
          <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            {tab === 'pedidos' && (
            <div className="flex flex-col gap-4" data-testid="aba-pedidos">
            <div className="flex flex-col gap-4" data-testid="em-rota-agora">

              <EmRotaNovo
                pedidos={inRoute}
                drivers={drivers}
                agora={Date.now()}
                onEntregue={deliver}
                onNaoEntregue={naoEntregue}
                onMapa={setLocationDriverId}
              />
            </div>
              <FinalizadosNovo
                lista={lista}
                filtrados={concluidosFiltrados}
                carregando={carregandoLista}
                semDatas={periodo === 'personalizado' && !intervalo}
                detalheId={detalhe?.id ?? null}
                onAbrir={(o) => setDetalhe(detalhe?.id === o.id ? null : o)}
                nomeMotoboy={(o) => (o.entregadorId ? driverName(o.entregadorId) : o.entregadorNome ?? '—')}
                filtros={{
                  periodo, setPeriodo, rotulos: ROTULO_PERIODO,
                  de: periodoDe, setDe: setPeriodoDe, ate: periodoAte, setAte: setPeriodoAte,
                  busca: filtroBusca, setBusca: setFiltroBusca,
                  status: filtroStatus, setStatus: setFiltroStatus,
                  min: filtroValorMin, setMin: setFiltroValorMin, max: filtroValorMax, setMax: setFiltroValorMax,
                  ativos: filtrosAtivos, limpar: limparFiltros,
                }}
              />
            </div>
            )}
          </section>
          )}
        </div>
      </div>

      {detalhe && (
        <PainelPedido
          pedido={detalhe}
          agora={Date.now()}
          onFechar={() => setDetalhe(null)}
          editandoPag={editandoPag}
          setEditandoPag={setEditandoPag}
          onPagamentoAlterado={() => { if (restauranteId) void refetch(restauranteId) }}
          reimpEstado={reimpEstado}
          onReimprimir={async () => { setReimpEstado('enviando'); try { await solicitarReimpressao(supabase, detalhe.id); setReimpEstado('ok') } catch { setReimpEstado('erro') } }}
          onCancelar={() => setError('Pedido finalizado não pode ser cancelado.')}
        />
      )}
      </div>

      {/* Novo entregador: gaveta com o cadastro completo. Ao salvar, já abre o
          link/QR de acesso — é a próxima coisa que o dono precisa mandar. */}
      {addDriverOpen && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setAddDriverOpen(false)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          addDriverOpen ? 'translate-x-0' : 'invisible translate-x-full',
        ].join(' ')}
        aria-hidden={!addDriverOpen}
      >
        <div className="flex items-center justify-between border-b border-[var(--adm-borda)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Novo entregador</h2>
            <p className="mt-0.5 text-[12px] text-[var(--adm-texto-suave)]">Depois de salvar você recebe o link de acesso dele.</p>
          </div>
          <button onClick={() => setAddDriverOpen(false)} aria-label="Fechar" className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-[4px] text-lg text-[var(--adm-texto-suave)] hover:bg-[var(--adm-hover)]">
            ×
          </button>
        </div>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            void addDriver()
          }}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <div className="flex items-center gap-3 rounded-[6px] bg-[var(--adm-superficie-2)] p-3">
              <Avatar nome={novoDriver.nome || '?'} fotoUrl={null} tamanho={44} />
              <div className="min-w-0 text-[12px] text-[var(--adm-texto-suave)]">
                <p className="truncate text-[14px] font-semibold text-[var(--adm-texto)]">{novoDriver.nome.trim() || 'Nome do entregador'}</p>
                {[novoDriver.veiculo, novoDriver.placa].filter(Boolean).join(' · ') || 'A foto pode ser enviada depois, em Editar.'}
              </div>
            </div>
            <CampoEntregador rotulo="Nome" obrigatorio>
              <input
                value={novoDriver.nome}
                onChange={(e) => setNovoDriver((d) => ({ ...d, nome: e.target.value }))}
                placeholder="Como a equipe chama ele"
                maxLength={60}
                className={CLASSE_CAMPO}
              />
            </CampoEntregador>
            <CampoEntregador rotulo="WhatsApp" dica="Usado para ligar e para mandar o link de acesso.">
              <input
                value={novoDriver.telefone}
                onChange={(e) => setNovoDriver((d) => ({ ...d, telefone: mascararTelefoneBR(e.target.value) }))}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                className={CLASSE_CAMPO}
              />
            </CampoEntregador>
            <div className="grid grid-cols-[1fr_130px] gap-3">
              <CampoEntregador rotulo="Veículo">
                <input
                  value={novoDriver.veiculo}
                  onChange={(e) => setNovoDriver((d) => ({ ...d, veiculo: e.target.value }))}
                  placeholder="Ex.: Honda CG 160"
                  maxLength={40}
                  className={CLASSE_CAMPO}
                />
              </CampoEntregador>
              <CampoEntregador rotulo="Placa">
                <input
                  value={novoDriver.placa}
                  onChange={(e) => setNovoDriver((d) => ({ ...d, placa: e.target.value.toUpperCase() }))}
                  placeholder="ABC1D23"
                  maxLength={8}
                  className={`${CLASSE_CAMPO} uppercase`}
                />
              </CampoEntregador>
            </div>
            {novoDriver.telefone && !telefoneCompleto(novoDriver.telefone) && (
              <p className="text-[12px] text-[var(--adm-laranja)]">O telefone parece incompleto — confira o DDD e os dígitos.</p>
            )}
          </div>
          <div className="flex gap-2.5 border-t border-[var(--adm-borda)] px-5 py-3.5">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setAddDriverOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={addingDriver || !novoDriver.nome.trim()}>
              {addingDriver ? 'Salvando…' : 'Cadastrar'}
            </Button>
          </div>
        </form>
      </aside>

      {/* Fechamento de caixa — por turno (0114) */}
      <CaixaTurnoGaveta aberto={closingOpen} onFechar={() => setClosingOpen(false)} />

      {/* Acesso do entregador (login e senha) */}
      {linkDriver && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={() => setLinkDriver(null)} />}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[380px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          linkDriver ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold">Acesso do entregador</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{linkDriver?.nome}</p>
          </div>
          <button onClick={() => setLinkDriver(null)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {/* 10/10: sem QR de acesso nem link mágico — login e senha no app (components/logistica/acesso-motoboy). */}
          {linkDriver && (
            <AcessoMotoboy
              key={linkDriver.id}
              id={linkDriver.id}
              nome={linkDriver.nome}
              telefone={linkDriver.telefone}
              desativado={linkDriver.desativado}
              credencialNova={credencialNova?.id === linkDriver.id ? credencialNova : null}
              onMudou={() => {
                setLinkDriver(null)
                if (restauranteId) void refetchAgora(restauranteId)
              }}
            />
          )}
        </div>
      </aside>

      {/* Localização do entregador */}
      {locationDriver && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#111827]/55 p-4" onClick={() => setLocationDriverId(null)}>
          <div className="flex h-[88vh] w-full max-w-4xl flex-col rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold">Localização — {locationDriver.nome}</h2>
                {locationDriver.localizacao && (
                  <p className="mt-0.5 text-xs text-text-subtle">Atualizado {tempoRelativo(locationDriver.localizacao.atualizadaEm)}</p>
                )}
              </div>
              <button onClick={() => setLocationDriverId(null)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
                ×
              </button>
            </div>
            <div className="flex-1 p-4.5">
              {locationDriver.localizacao ? (
                <RouteMap
                  apiKey={MAPS_KEY}
                  origin={locationOrigem}
                  stops={locationDriverStops}
                  loja={lojaMapa}
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
            <h2 className="text-[15px] font-semibold">Perfil do entregador</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{profileDriver?.nome}</p>
          </div>
          <button onClick={() => setProfileDriverId(null)} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
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
              <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-semibold text-text-subtle">
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
