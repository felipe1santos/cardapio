'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Plug, Truck } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { NextaConfigPublica } from '@/lib/queries/nexta'

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
  baseUrl: string
  clientId: string
  clientSecret: string
  merchantId: string
  merchantName: string
  cnpj: string
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
  baseUrl: '',
  clientId: '',
  clientSecret: '',
  merchantId: '',
  merchantName: '',
  cnpj: '',
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
    baseUrl: c.baseUrl,
    clientId: c.clientId,
    clientSecret: '', // write-only: o servidor nunca devolve o segredo salvo
    merchantId: c.merchantId,
    merchantName: c.merchantName,
    cnpj: c.cnpj,
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

  async function alternarAtivo() {
    const proximo = !form.ativo
    set('ativo', proximo)
    await salvar({ ativo: proximo })
  }

  // Montada no client: o webhook precisa apontar pro domínio público de verdade, e é
  // esta página que sabe em qual origem ela está rodando.
  const webhookUrl = config?.webhookToken && typeof window !== 'undefined' ? `${window.location.origin}/api/nexta/webhook/${config.webhookToken}` : ''

  const conectado = Boolean(config?.ativo && config.temSecret && config.baseUrl)

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
          <div className="max-w-2xl space-y-6">
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
                  <input
                    value={form.baseUrl}
                    onChange={(e) => set('baseUrl', e.target.value)}
                    placeholder="https://bck.nextadelivery.app/api:..."
                    className={inputCls}
                  />
                  <p className="mt-1.5 text-[11px] text-text-subtle">O Nexta fornece uma URL por estabelecimento.</p>
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
                      {config?.temSecret ? 'Deixe em branco para manter o segredo atual.' : 'O Nexta emite um par por loja.'}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Nome da loja no Nexta</label>
                    <input value={form.merchantName} onChange={(e) => set('merchantName', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>CNPJ (opcional)</label>
                    <input value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0000-00" className={inputCls} />
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Merchant ID</label>
                  <input
                    value={form.merchantId}
                    onChange={(e) => set('merchantId', e.target.value)}
                    placeholder={form.clientId || 'preenchido com o Client ID ao salvar'}
                    className={inputCls}
                  />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-subtle">
                    Identificador da sua loja no padrão Open Delivery. O Nexta só reconhece a loja quando este valor é igual ao
                    Client ID — deixe em branco para preenchermos automaticamente. Só altere se o suporte deles pedir.
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
