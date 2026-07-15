'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Bike, Package, Truck, Users, ClipboardCheck, Phone, User, MapPin, Plus, Wallet, ArrowRight } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RouteMap } from '@/components/maps/route-map'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { notificarPedido } from '@/lib/notificar'
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

type Tab = 'despacho' | 'concluidos'

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

  const refetch = useCallback(
    async (id: string) => {
      try {
        const [pedidos, entregadores, finalizados, aberto] = await Promise.all([
          listarPedidosLogistica(supabase, id),
          listarEntregadores(supabase, id),
          listarPedidosConcluidos(supabase, id, inicioDoDiaISO()),
          buscarDespachoAberto(supabase, id),
        ])
        setOrders(pedidos)
        setDrivers(entregadores)
        setConcluidos(finalizados)
        setDespachoAberto(aberto)
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
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase, refetch])

  // Refetch periódico — "motoboy online" depende do horário atual, então precisa
  // recalcular mesmo sem eventos de realtime (ex.: motoboy fechou o app).
  useEffect(() => {
    if (!restauranteId) return
    const interval = setInterval(() => refetch(restauranteId), 10000)
    return () => clearInterval(interval)
  }, [restauranteId, refetch])

  const available = drivers.filter((d) => d.status === 'online')
  const unassigned = orders.filter((o) => o.status === 'pronto' && !o.entregadorId)
  const inRoute = orders.filter((o) => o.status === 'em_rota')
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

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        {error && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard tint="primary" value={available.length} label="Entregadores online" icon={<Bike className="h-5 w-5" strokeWidth={2} />} />
          <StatCard tint="orange" value={unassigned.length} label="Aguardando despacho" icon={<Package className="h-5 w-5" strokeWidth={2} />} />
          <StatCard tint="blue" value={inRoute.length} label="Em rota" icon={<Truck className="h-5 w-5" strokeWidth={2} />} />
          <StatCard tint="slate" value={drivers.length} label="Entregadores cadastrados" icon={<Users className="h-5 w-5" strokeWidth={2} />} />
        </div>

        <div className="flex flex-shrink-0 gap-0.5 border-b border-border">
          {([
            { id: 'despacho', label: 'Despacho' },
            { id: 'concluidos', label: 'Concluídos' },
          ] as { id: Tab; label: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
                tab === t.id ? 'border-tab-active bg-tab-active text-white' : 'border-transparent text-text-subtle hover:text-text-main',
              ].join(' ')}
            >
              {t.label}
              {t.id === 'concluidos' && concluidos.length > 0 && (
                <span className="ml-1.5 rounded-full bg-page px-1.5 py-0.5 text-[11px] font-bold text-text-subtle">{concluidos.length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[280px_1fr]">
          {/* Entregadores */}
          <aside className="flex flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="flex items-center justify-between bg-text-main px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" strokeWidth={2.5} />
                <h3 className="text-sm font-bold">Entregadores</h3>
              </div>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{drivers.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {drivers.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-text-subtle">Nenhum entregador cadastrado ainda.</div>
              )}
              {drivers.map((driver) => (
                <div key={driver.id} className="rounded-menuzia border border-border p-3">
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
            <div className="space-y-2 border-t border-border p-3">
              {addDriverOpen && (
                <>
                  <input
                    value={novoDriver.nome}
                    onChange={(e) => setNovoDriver((d) => ({ ...d, nome: e.target.value }))}
                    placeholder="Nome do entregador"
                    autoFocus
                    className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                  />
                  <input
                    value={novoDriver.telefone}
                    onChange={(e) => setNovoDriver((d) => ({ ...d, telefone: e.target.value }))}
                    placeholder="Telefone (opcional)"
                    className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => {
                        setAddDriverOpen(false)
                        setNovoDriver({ nome: '', telefone: '' })
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button variant="primary" className="flex-1" onClick={addDriver} disabled={addingDriver || !novoDriver.nome.trim()}>
                      {addingDriver ? 'Adicionando…' : 'Adicionar'}
                    </Button>
                  </div>
                </>
              )}
              {!addDriverOpen && (
                <Button variant="primary" className="w-full" onClick={() => setAddDriverOpen(true)}>
                  <Plus className="h-4 w-4" /> Entregador
                </Button>
              )}
              <Button
                variant="outline"
                className="w-full !border-yellow-400 !bg-yellow-300 !text-black hover:!bg-yellow-400"
                onClick={openClosing}
              >
                <Wallet className="h-4 w-4" /> Fechamento de caixa
              </Button>
            </div>
          </aside>

          {/* Pedidos */}
          <section className="flex flex-col gap-4 overflow-y-auto">
            {tab === 'despacho' && (
            <>
            <div className="overflow-hidden rounded-menuzia border border-border bg-white">
              <div className="flex items-center justify-between bg-status-pending px-4 py-3 text-white">
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
                      <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[200px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
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
              {despachoAberto && (
                <div className="flex items-center gap-1.5 border-b border-border bg-status-pending/5 px-4 py-2 text-[12px] font-medium text-status-pending">
                  <Bike className="h-3.5 w-3.5 flex-shrink-0" /> Despacho aberto — os entregadores podem pegar estes pedidos pelo app.
                </div>
              )}
              <div className="divide-y divide-border">
                {unassigned.length === 0 && <div className="p-6 text-center text-sm text-text-subtle">Nenhum pedido aguardando despacho</div>}
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
                        </div>
                      </div>
                    </div>
                    <div className="relative">
                      <Button variant="dispatch" onClick={() => setAssigning(assigning === order.id ? null : order.id)}>
                        Atribuir entregador
                      </Button>
                      {assigning === order.id && (
                        <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[200px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
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

            <div className="overflow-hidden rounded-menuzia border border-border bg-white">
              <div className="flex items-center justify-between bg-status-preparing px-4 py-3 text-white">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4" strokeWidth={2.5} />
                  <h3 className="text-sm font-bold">Em rota</h3>
                </div>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{inRoute.length}</span>
              </div>
              <div className="divide-y divide-border">
                {inRoute.length === 0 && <div className="p-6 text-center text-sm text-text-subtle">Nenhuma entrega em rota</div>}
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
                        <span className="inline-flex items-center gap-1 rounded-full bg-status-preparing/10 px-2 py-0.5 text-[12px] font-semibold text-status-preparing">
                          <Bike className="h-3.5 w-3.5" /> {driverName(order.entregadorId)}
                        </span>
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
                      <Button variant="success" onClick={() => deliver(order.id)}>
                        Entregue
                      </Button>
                      <Button variant="outline" className="border-danger text-danger hover:bg-danger-bg" onClick={() => naoEntregue(order.id)}>
                        Não entregue
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </>
            )}

            {tab === 'concluidos' && (
            <div className="overflow-hidden rounded-menuzia border border-border bg-white">
              <div className="flex items-center justify-between bg-text-main px-4 py-3 text-white">
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
