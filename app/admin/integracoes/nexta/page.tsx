'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, KeyRound, Link2, Plug, RefreshCw, Truck } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { motivoRejeicaoTexto, nextaEntregaAtiva, nextaEventoTexto, nextaEventoTom } from '@/lib/nexta-eventos'
import { listarNextaEntregasDetalhadas, type NextaConfigPublica, type NextaEntregaDetalhada } from '@/lib/queries/nexta'

// Mesma string de NEXTA_BASE_URL em lib/nexta.ts (server-only, não importável no client).
// É fixa para todas as lojas e não editável — mostrada só para conferência.
const NEXTA_BASE_URL_FIXA = 'https://bck.nextadelivery.app/api:lZyx1NRE'
// Azul petróleo escuro: sinaliza que é uma chave do sistema, não um campo de digitação.
const AZUL_PETROLEO = '#0B3D4E'

type SubNav = 'nexta'

const SUB_NAV: { id: SubNav; label: string }[] = [{ id: 'nexta', label: 'Nexta Delivery' }]

const VEICULOS = [
  { value: 'MOTORBIKE_BAG', label: 'Moto com bag' },
  { value: 'MOTORBIKE', label: 'Moto' },
  { value: 'BIKE_BAG', label: 'Bicicleta com bag' },
  { value: 'BIKE', label: 'Bicicleta' },
  { value: 'CAR', label: 'Carro' },
  { value: 'VAN', label: 'Van' },
]
const CONTAINERS = [
  { value: 'THERMIC', label: 'Térmico' },
  { value: 'NORMAL', label: 'Comum' },
]
const TAMANHOS = [
  { value: 'SMALL', label: 'Pequeno' },
  { value: 'MEDIUM', label: 'Médio' },
  { value: 'LARGE', label: 'Grande' },
]

interface Form {
  ativo: boolean
  clientId: string
  clientSecret: string
  merchantId: string
  merchantName: string
  pickup: { rua: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string }
  vehicleType: string
  container: string
  containerSize: string
  pickupLimitMin: string
  deliveryLimitMin: string
  limitTimesAsDatetime: boolean
  pesoPadraoG: string
}

const FORM_VAZIO: Form = {
  ativo: false,
  clientId: '',
  clientSecret: '',
  merchantId: '',
  merchantName: '',
  pickup: { rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', cep: '' },
  vehicleType: 'MOTORBIKE_BAG',
  container: 'THERMIC',
  containerSize: 'MEDIUM',
  pickupLimitMin: '30',
  deliveryLimitMin: '60',
  limitTimesAsDatetime: false,
  pesoPadraoG: '1500',
}

function formDaConfig(c: NextaConfigPublica): Form {
  return {
    ativo: c.ativo,
    clientId: c.clientId,
    clientSecret: '', // write-only: o servidor nunca devolve o segredo salvo
    merchantId: c.merchantId,
    merchantName: c.merchantName,
    pickup: { ...c.pickup },
    vehicleType: c.vehicleType,
    container: c.container,
    containerSize: c.containerSize,
    pickupLimitMin: String(c.pickupLimitMin),
    deliveryLimitMin: String(c.deliveryLimitMin),
    limitTimesAsDatetime: c.limitTimesAsDatetime,
    pesoPadraoG: String(c.pesoPadraoG),
  }
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

type Periodo = 'hoje' | '7d' | '30d'

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
]

function desdeDoPeriodo(periodo: Periodo): string {
  if (periodo === 'hoje') {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
  }
  return new Date(Date.now() - (periodo === '7d' ? 7 : 30) * 24 * 3600 * 1000).toISOString()
}

function dataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Número grande + rótulo, no padrão dos cards do Dashboard. */
function Metrica({ valor, label, tom }: { valor: string; label: string; tom?: 'preco' }) {
  return (
    <div className="rounded-menuzia border border-border bg-white p-3.5">
      <div className={`text-2xl font-bold leading-none ${tom === 'preco' ? 'text-price-text' : 'text-text-main'}`}>{valor}</div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</div>
    </div>
  )
}

const inputCls = 'w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] outline-none focus:border-primary'
const labelCls = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle'

/** Campo somente-leitura com botão de copiar — merchant id e URL do webhook. */
function CampoCopiavel({ label, valor, ajuda }: { label: string; valor: string; ajuda?: string }) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="flex items-stretch gap-1.5">
        <div className="flex min-w-0 flex-1 items-center break-all rounded-menuzia border border-border bg-page px-2.5 py-2 text-[12px] text-text-main">
          {valor || <span className="text-text-subtle">— salve a configuração para gerar —</span>}
        </div>
        {valor && (
          <button
            type="button"
            onClick={copiar}
            title="Copiar"
            className="flex w-9 flex-shrink-0 items-center justify-center rounded-menuzia border border-border text-text-subtle hover:border-primary hover:text-primary"
          >
            {copiado ? <Check className="h-4 w-4 text-status-ready" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
      </div>
      {ajuda && <p className="mt-1.5 text-[11px] leading-relaxed text-text-subtle">{ajuda}</p>}
    </div>
  )
}

export default function IntegracaoNextaPage() {
  const [subNav, setSubNav] = useState<SubNav>('nexta')
  const [config, setConfig] = useState<NextaConfigPublica | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [testando, setTestando] = useState(false)
  const [teste, setTeste] = useState<{ ok: boolean; preco?: number; erro?: string } | null>(null)
  const [copiadoMerchant, setCopiadoMerchant] = useState(false)

  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [entregas, setEntregas] = useState<NextaEntregaDetalhada[]>([])
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'ativas' | 'concluidas' | 'canceladas'>('todos')
  const [atualizando, setAtualizando] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/nexta/config')
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { config: NextaConfigPublica | null; sugestao?: { merchantName: string; cep: string } }
      setConfig(data.config)
      setForm(
        data.config
          ? formDaConfig(data.config)
          : { ...FORM_VAZIO, merchantName: data.sugestao?.merchantName ?? '', pickup: { ...FORM_VAZIO.pickup, cep: data.sugestao?.cep ?? '' } }
      )
    } catch {
      setErro('Não foi possível carregar a configuração da integração.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  const carregarEntregas = useCallback(
    async (id: string, p: Periodo) => {
      try {
        setEntregas(await listarNextaEntregasDetalhadas(supabase, id, desdeDoPeriodo(p)))
      } catch {
        /* monitor é informativo — não vale derrubar a tela de config por causa dele */
      }
    },
    [supabase]
  )

  useEffect(() => {
    let ativo = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!ativo || !id) return
      setRestauranteId(id)
      await carregarEntregas(id, periodo)

      // Mesmo realtime do despacho: o monitor reflete o webhook na hora.
      const canal = supabase
        .channel(`nexta-monitor-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'nexta_entregas', filter: `restaurante_id=eq.${id}` }, () =>
          carregarEntregas(id, periodo)
        )
        .subscribe()
      return () => {
        supabase.removeChannel(canal)
      }
    })()
    return () => {
      ativo = false
    }
  }, [supabase, periodo, carregarEntregas])

  const metricas = useMemo(() => {
    const concluidas = entregas.filter((e) => e.status === 'ORDER_DELIVERED' || e.status === 'DELIVERY_FINISHED')
    const perdidas = entregas.filter((e) => e.status === 'CANCELLED' || e.status === 'REJECTED')
    // Custo real = o que foi efetivamente rodado. Corrida recusada não gera fatura, e
    // somá-la inflaria o custo que o lojista vê.
    const comCusto = entregas.filter((e) => e.preco !== null && e.status !== 'REJECTED')
    const custoTotal = comCusto.reduce((s, e) => s + (e.preco ?? 0), 0)
    const coletas = entregas.map((e) => e.minutosAteColeta).filter((m): m is number => m !== null)
    return {
      solicitadas: entregas.length,
      concluidas: concluidas.length,
      perdidas: perdidas.length,
      custoTotal,
      custoMedio: comCusto.length > 0 ? custoTotal / comCusto.length : 0,
      minutosColeta: coletas.length > 0 ? coletas.reduce((s, m) => s + m, 0) / coletas.length : null,
    }
  }, [entregas])

  const entregasFiltradas = useMemo(
    () =>
      entregas.filter((e) => {
        if (filtroStatus === 'ativas') return nextaEntregaAtiva(e.status)
        if (filtroStatus === 'concluidas') return e.status === 'ORDER_DELIVERED' || e.status === 'DELIVERY_FINISHED'
        if (filtroStatus === 'canceladas') return e.status === 'CANCELLED' || e.status === 'REJECTED'
        return true
      }),
    [entregas, filtroStatus]
  )

  async function atualizarEntrega(pedidoId: string) {
    setAtualizando(pedidoId)
    try {
      await fetch('/api/admin/nexta/reconciliar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId }),
      })
      if (restauranteId) await carregarEntregas(restauranteId, periodo)
    } finally {
      setAtualizando(null)
    }
  }

  function set<K extends keyof Form>(key: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [key]: valor }))
    setSalvo(false)
  }

  function setPickup(key: keyof Form['pickup'], valor: string) {
    setForm((f) => ({ ...f, pickup: { ...f.pickup, [key]: valor } }))
    setSalvo(false)
  }

  async function salvar(patch?: Partial<{ ativo: boolean }>) {
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch('/api/admin/nexta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          ...patch,
          pickupLimitMin: Number(form.pickupLimitMin),
          deliveryLimitMin: Number(form.deliveryLimitMin),
          pesoPadraoG: Number(form.pesoPadraoG),
        }),
      })
      const data = (await res.json()) as { config?: NextaConfigPublica; error?: string }
      if (!res.ok || !data.config) throw new Error(data.error)
      setConfig(data.config)
      setForm(formDaConfig(data.config))
      setSalvo(true)
    } catch {
      setErro('Não foi possível salvar a configuração.')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    setTestando(true)
    setTeste(null)
    try {
      const res = await fetch('/api/admin/nexta/testar', { method: 'POST' })
      setTeste((await res.json()) as { ok: boolean; preco?: number; erro?: string })
    } catch {
      setTeste({ ok: false, erro: 'Não foi possível testar a conexão.' })
    } finally {
      setTestando(false)
    }
  }

  // Merchant ID é um código livre que a loja inventa e envia ao Nexta pelo WhatsApp — eles
  // cadastram o mesmo código do lado deles. O botão gera um legível pra não errar.
  function gerarMerchantId() {
    const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 6) : String(Date.now()).slice(-6)
    set('merchantId', `menuzia-${rand}`)
  }

  async function copiarMerchantId() {
    if (!form.merchantId) return
    try {
      await navigator.clipboard.writeText(form.merchantId)
      setCopiadoMerchant(true)
      setTimeout(() => setCopiadoMerchant(false), 2000)
    } catch {
      setCopiadoMerchant(false)
    }
  }

  async function alternarAtivo() {
    const proximo = !form.ativo
    set('ativo', proximo)
    await salvar({ ativo: proximo })
  }

  // Montada no client: o webhook precisa apontar pro domínio público de verdade, e é
  // esta página que sabe em qual origem ela está rodando.
  const webhookUrl = config?.webhookToken && typeof window !== 'undefined' ? `${window.location.origin}/api/nexta/webhook/${config.webhookToken}` : ''

  const conectado = Boolean(config?.ativo && config.temSecret)

  if (carregando) {
    return (
      <>
        <TopBar title="Integrações" breadcrumb="Integrações › Nexta Delivery" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando integração…</div>
      </>
    )
  }

  return (
    <>
      <TopBar title="Integrações" breadcrumb="Integrações › Nexta Delivery" />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-shrink-0 gap-0.5 border-b border-border bg-white px-5 pt-2">
          {SUB_NAV.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubNav(s.id)}
              className={[
                'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
                subNav === s.id ? 'border-primary text-primary' : 'border-transparent text-text-subtle hover:text-text-main',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="max-w-4xl space-y-6">
            {erro && <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{erro}</div>}

            {/* Status da conexão + credenciais */}
            <Card>
              <div className="mb-0.5 flex items-center gap-2">
                <Truck className="h-5 w-5 flex-shrink-0 text-primary" strokeWidth={2.25} />
                <h3 className="text-[13px] font-bold text-text-main">Nexta Delivery</h3>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-menuzia px-2 py-0.5 text-[11px] font-semibold ${
                    conectado ? 'bg-price-bg text-price-text' : 'bg-page text-text-subtle'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${conectado ? 'bg-status-ready' : 'bg-text-subtle'}`} />
                  {conectado ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
                Rede de motoboys terceirizada. Com a integração ativa, o Nexta aparece como uma opção de entregador no despacho —
                com preço e tempo de coleta cotados na hora. Seus entregadores próprios continuam funcionando normalmente.
              </p>

              <div className="space-y-3.5">
                <div>
                  <label className={labelCls}>URL base da API</label>
                  <div
                    className="flex items-center gap-2 break-all rounded-menuzia border px-2.5 py-2 text-[12px] font-semibold"
                    style={{ color: AZUL_PETROLEO, borderColor: `${AZUL_PETROLEO}40`, backgroundColor: `${AZUL_PETROLEO}0D` }}
                  >
                    <KeyRound className="h-4 w-4 flex-shrink-0" strokeWidth={2.25} />
                    <span className="min-w-0 flex-1">{NEXTA_BASE_URL_FIXA}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-text-subtle">Fixa para todas as lojas — não editável.</p>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Client ID</label>
                    <input value={form.clientId} onChange={(e) => set('clientId', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Client Secret</label>
                    <input
                      type="password"
                      value={form.clientSecret}
                      onChange={(e) => set('clientSecret', e.target.value)}
                      placeholder={config?.temSecret ? '••••••••  (salvo)' : ''}
                      autoComplete="new-password"
                      className={inputCls}
                    />
                    <p className="mt-1.5 text-[11px] text-text-subtle">
                      {config?.temSecret ? 'Salvo. Deixe em branco para manter o segredo atual.' : 'O Nexta emite um par por loja.'}
                    </p>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Nome da loja no Nexta</label>
                  <input value={form.merchantName} onChange={(e) => set('merchantName', e.target.value)} className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Merchant ID</label>
                  <div className="flex items-stretch gap-1.5">
                    <input
                      value={form.merchantId}
                      onChange={(e) => set('merchantId', e.target.value)}
                      placeholder="ex.: menuzia-a1b2c3"
                      className={`${inputCls} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={gerarMerchantId}
                      className="flex-shrink-0 rounded-menuzia border border-border px-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:border-primary hover:text-primary"
                    >
                      Gerar
                    </button>
                    <button
                      type="button"
                      onClick={copiarMerchantId}
                      disabled={!form.merchantId}
                      title="Copiar"
                      className="flex w-9 flex-shrink-0 items-center justify-center rounded-menuzia border border-border text-text-subtle hover:border-primary hover:text-primary disabled:opacity-40"
                    >
                      {copiadoMerchant ? <Check className="h-4 w-4 text-status-ready" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-subtle">
                    Código que você inventa aqui (use <strong>Gerar</strong> se quiser). <strong>Salve</strong>, copie e envie ao
                    Nexta pelo WhatsApp — eles cadastram esse mesmo código do lado deles. A partir daí os pedidos desta loja são
                    reconhecidos por ele.
                  </p>
                </div>

                <CampoCopiavel
                  label="URL do webhook"
                  valor={webhookUrl}
                  ajuda="Envie esta URL ao suporte do Nexta — é por ela que os eventos da entrega (aceito, coletado, entregue) chegam até aqui. O registro é manual, não há endpoint automático."
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button variant="primary" onClick={() => salvar()} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar'}
                </Button>
                <Button variant="outline" onClick={testar} disabled={testando || salvando}>
                  <Plug className="h-4 w-4" /> {testando ? 'Testando…' : 'Testar conexão'}
                </Button>
                <Button
                  variant={form.ativo ? 'secondary' : 'success'}
                  onClick={alternarAtivo}
                  disabled={salvando || (!form.ativo && !config?.temSecret && !form.clientSecret)}
                >
                  {form.ativo ? 'Desativar integração' : 'Ativar integração'}
                </Button>
                {salvo && !salvando && <span className="text-[13px] font-medium text-status-ready">Alterações salvas.</span>}
              </div>

              {teste && (
                <div
                  className={`mt-3 rounded-menuzia border px-3 py-2 text-[12px] ${
                    teste.ok ? 'border-status-ready/40 bg-price-bg text-price-text' : 'border-danger bg-danger-bg text-danger'
                  }`}
                >
                  {teste.ok
                    ? `Conexão OK — cotação de teste retornou ${brl(teste.preco ?? 0)}.`
                    : `Falha na conexão: ${teste.erro ?? 'erro desconhecido'}`}
                </div>
              )}
            </Card>

            {/* Endereço de coleta */}
            <Card>
              <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Endereço de coleta</h3>
              <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
                Onde o motoboy do Nexta busca os pedidos. O padrão Open Delivery exige o endereço separado em campos, por isso ele é
                preenchido aqui e não no cadastro da loja.
              </p>
              <div className="space-y-3.5">
                <div className="grid gap-3.5 sm:grid-cols-[2fr_1fr]">
                  <div>
                    <label className={labelCls}>Rua</label>
                    <input value={form.pickup.rua} onChange={(e) => setPickup('rua', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Número</label>
                    <input value={form.pickup.numero} onChange={(e) => setPickup('numero', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Complemento</label>
                    <input
                      value={form.pickup.complemento}
                      onChange={(e) => setPickup('complemento', e.target.value)}
                      placeholder="Loja 1"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Bairro</label>
                    <input value={form.pickup.bairro} onChange={(e) => setPickup('bairro', e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-[2fr_80px_1fr]">
                  <div>
                    <label className={labelCls}>Cidade</label>
                    <input value={form.pickup.cidade} onChange={(e) => setPickup('cidade', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>UF</label>
                    <input
                      value={form.pickup.uf}
                      onChange={(e) => setPickup('uf', e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="SP"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>CEP</label>
                    <input value={form.pickup.cep} onChange={(e) => setPickup('cep', e.target.value)} placeholder="00000-000" className={inputCls} />
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-text-subtle">
                  As coordenadas são calculadas automaticamente a partir deste endereço na primeira cotação.
                </p>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <Button variant="primary" onClick={() => salvar()} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar endereço'}
                </Button>
              </div>
            </Card>

            {/* Preferências de despacho */}
            <Card>
              <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Preferências de despacho</h3>
              <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
                O que pedimos ao Nexta em cada corrida. Vale para todas as entregas desta loja.
              </p>
              <div className="space-y-3.5">
                <div className="grid gap-3.5 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Veículo</label>
                    <select value={form.vehicleType} onChange={(e) => set('vehicleType', e.target.value)} className={inputCls}>
                      {VEICULOS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Container</label>
                    <select value={form.container} onChange={(e) => set('container', e.target.value)} className={inputCls}>
                      {CONTAINERS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Tamanho</label>
                    <select value={form.containerSize} onChange={(e) => set('containerSize', e.target.value)} className={inputCls}>
                      {TAMANHOS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-3">
                  <div>
                    <label className={labelCls}>Limite de coleta (min)</label>
                    <input
                      value={form.pickupLimitMin}
                      onChange={(e) => set('pickupLimitMin', e.target.value)}
                      inputMode="numeric"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Limite de entrega (min)</label>
                    <input
                      value={form.deliveryLimitMin}
                      onChange={(e) => set('deliveryLimitMin', e.target.value)}
                      inputMode="numeric"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Peso padrão (g)</label>
                    <input value={form.pesoPadraoG} onChange={(e) => set('pesoPadraoG', e.target.value)} inputMode="numeric" className={inputCls} />
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-menuzia border border-border bg-page p-3">
                  <input
                    type="checkbox"
                    checked={form.limitTimesAsDatetime}
                    onChange={(e) => set('limitTimesAsDatetime', e.target.checked)}
                    className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-border accent-primary"
                  />
                  <span>
                    <span className="block text-[12px] font-semibold text-text-main">Enviar limites de tempo como data/hora</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-text-subtle">
                      Opção avançada. O padrão Open Delivery pede os limites em minutos; ligue isto só se o suporte do Nexta pedir
                      data/hora completa.
                    </span>
                  </span>
                </label>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <Button variant="primary" onClick={() => salvar()} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar preferências'}
                </Button>
              </div>
            </Card>

            {/* Métricas */}
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-bold text-text-main">Entregas pelo Nexta</h3>
                  <p className="mt-0.5 text-[12px] text-text-subtle">Números apurados pelas corridas registradas aqui.</p>
                </div>
                <div className="flex gap-0.5 rounded-menuzia border border-border p-0.5">
                  {PERIODOS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPeriodo(p.id)}
                      className={`rounded-menuzia px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                        periodo === p.id ? 'bg-primary text-white' : 'text-text-subtle hover:text-text-main'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Metrica valor={String(metricas.solicitadas)} label="Solicitadas" />
                <Metrica valor={String(metricas.concluidas)} label="Concluídas" />
                <Metrica valor={String(metricas.perdidas)} label="Canceladas/recusadas" />
                <Metrica valor={brl(metricas.custoTotal)} label="Custo total" tom="preco" />
                <Metrica valor={brl(metricas.custoMedio)} label="Custo médio" tom="preco" />
                <Metrica
                  valor={metricas.minutosColeta === null ? '—' : `${Math.round(metricas.minutosColeta)} min`}
                  label="Tempo médio até a coleta"
                />
              </div>
            </Card>

            {/* Monitor */}
            <Card className="!p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4.5">
                <div>
                  <h3 className="text-[13px] font-bold text-text-main">Monitor de entregas</h3>
                  <p className="mt-0.5 text-[12px] text-text-subtle">Atualiza em tempo real conforme o Nexta avisa.</p>
                </div>
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                  className="rounded-menuzia border border-border px-2.5 py-1.5 font-sans text-[12px] outline-none focus:border-primary"
                >
                  <option value="todos">Todos os status</option>
                  <option value="ativas">Em andamento</option>
                  <option value="concluidas">Concluídas</option>
                  <option value="canceladas">Canceladas/recusadas</option>
                </select>
              </div>
              {entregasFiltradas.length === 0 ? (
                <div className="p-8 text-center text-sm text-text-subtle">
                  {entregas.length === 0 ? 'Nenhuma entrega solicitada ao Nexta neste período.' : 'Nenhuma entrega com esse filtro.'}
                </div>
              ) : (
                // A tabela rola sozinha em telas estreitas — a página nunca rola pro lado.
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-text-subtle">
                        <th className="px-4.5 py-2.5">Pedido</th>
                        <th className="px-3 py-2.5">Data/hora</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5">Entregador</th>
                        <th className="px-3 py-2.5 text-right">Corrida</th>
                        <th className="px-4.5 py-2.5 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {entregasFiltradas.map((e) => (
                        <tr key={e.id} className="hover:bg-page/60">
                          <td className="px-4.5 py-2.5 font-bold">{e.pedidoNumero === null ? '—' : `#${e.pedidoNumero}`}</td>
                          <td className="px-3 py-2.5 text-text-subtle">{dataHora(e.criadoEm)}</td>
                          <td className="px-3 py-2.5">
                            <Badge tone={nextaEventoTom(e.status)}>{nextaEventoTexto(e.status)}</Badge>
                            {e.status === 'REJECTED' && (
                              <div className="mt-1 text-[11px] text-text-subtle">{motivoRejeicaoTexto(e.rejeicaoMotivo)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2.5">{e.entregadorNome || <span className="text-text-subtle">—</span>}</td>
                          <td className="px-3 py-2.5 text-right font-semibold text-price-text">{e.preco === null ? '—' : brl(e.preco)}</td>
                          <td className="px-4.5 py-2.5">
                            <div className="flex items-center justify-end gap-1.5">
                              {nextaEntregaAtiva(e.status) && (
                                <button
                                  onClick={() => atualizarEntrega(e.pedidoId)}
                                  disabled={atualizando === e.pedidoId}
                                  title="Buscar o status atual no Nexta"
                                  className="flex h-7 w-7 items-center justify-center rounded-menuzia border border-border text-text-subtle hover:border-primary hover:text-primary disabled:opacity-50"
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 ${atualizando === e.pedidoId ? 'animate-spin' : ''}`} />
                                </button>
                              )}
                              {e.trackingUrl && (
                                <a
                                  href={e.trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex h-7 items-center rounded-menuzia border border-border px-2 text-[11px] font-semibold uppercase text-text-subtle hover:border-primary hover:text-primary"
                                >
                                  Rastrear
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Painel do Nexta */}
            <Card>
              <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Painel do Nexta</h3>
              <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
                Faturas, extrato financeiro e contratação de diária não têm API — ficam no painel do próprio Nexta.
              </p>
              <a
                href="https://nexta-est.flutterflow.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-menuzia border border-border bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main transition-colors hover:border-primary hover:text-primary"
              >
                <Link2 className="h-4 w-4" /> Abrir painel do Nexta
              </a>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
