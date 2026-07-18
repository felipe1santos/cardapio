'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ShieldCheck } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FacebookIcon, GoogleIcon, WhatsAppIcon } from '@/components/ui/brand-icons'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja, atualizarConfigLoja } from '@/lib/queries/ajustes'

interface WaStatus {
  configurado: boolean
  connected: boolean
  state: string | null
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-menuzia border border-border bg-white px-3 py-2.5 font-sans text-sm text-text-main outline-none transition-colors',
        'focus:border-primary placeholder:text-text-subtle/60 disabled:bg-page disabled:text-text-subtle',
        props.className ?? '',
      ].join(' ')}
    />
  )
}

function StatusPill({ ativo, labelAtivo = 'Conectado', labelInativo = 'Inativo' }: { ativo: boolean; labelAtivo?: string; labelInativo?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-menuzia px-2 py-0.5 text-[11px] font-semibold ${
        ativo ? 'bg-price-bg text-price-text' : 'bg-page text-text-subtle'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${ativo ? 'bg-status-ready' : 'bg-text-subtle'}`} />
      {ativo ? labelAtivo : labelInativo}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{children}</h2>
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

function WhatsAppCard() {
  const [wa, setWa] = useState<WaStatus | null>(null)
  const [waQr, setWaQr] = useState<string | null>(null)
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null)
  const [waBusy, setWaBusy] = useState(false)
  const [waError, setWaError] = useState<string | null>(null)
  const [qrAberto, setQrAberto] = useState(false)

  const atualizarStatusWhatsapp = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp/status')
      const data: WaStatus = await res.json()
      setWa(data)
      if (data.connected) setWaQr(null)
      return data
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    atualizarStatusWhatsapp()
  }, [atualizarStatusWhatsapp])

  // Enquanto o QR está na tela, verifica a cada 3s se o WhatsApp já foi conectado.
  useEffect(() => {
    if (!waQr) return
    const interval = setInterval(async () => {
      const data = await atualizarStatusWhatsapp()
      if (data?.connected) { clearInterval(interval); setQrAberto(false) }
    }, 3000)
    return () => clearInterval(interval)
  }, [waQr, atualizarStatusWhatsapp])

  async function conectarWhatsapp() {
    setWaBusy(true)
    setWaError(null)
    setQrAberto(true)
    try {
      const res = await fetch('/api/admin/whatsapp/conectar', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setWaQr(data.base64 ?? null)
      setWaPairingCode(data.pairingCode ?? null)
    } catch {
      setWaError('Não foi possível conectar. Verifique a configuração da Evolution API no servidor.')
    } finally {
      setWaBusy(false)
    }
  }

  async function desconectarWhatsapp() {
    setWaBusy(true)
    setWaError(null)
    try {
      await fetch('/api/admin/whatsapp/desconectar', { method: 'POST' })
      setWaQr(null)
      setWaPairingCode(null)
      await atualizarStatusWhatsapp()
    } finally {
      setWaBusy(false)
    }
  }

  return (
    <>
      <Card className="flex flex-col">
        <div className="mb-0.5 flex items-center gap-2">
          <WhatsAppIcon className="h-5 w-5 flex-shrink-0" />
          <h3 className="text-[13px] font-bold text-text-main">WhatsApp</h3>
          {wa?.connected && <StatusPill ativo labelAtivo="Conectado" />}
        </div>
        <p className="mb-3 flex-1 text-[12px] leading-relaxed text-text-subtle">
          Conecte o WhatsApp da loja para enviar automaticamente a confirmação do pedido (aceito), e os avisos de
          preparo, pronto e saiu para entrega ao cliente.
        </p>

        {wa === null ? (
          <p className="text-[12px] text-text-subtle">Verificando conexão…</p>
        ) : !wa.configurado ? (
          <p className="rounded-menuzia border border-warn bg-warn-bg px-3 py-2 text-[12px] text-warn">
            Evolution API não configurada no servidor (variáveis EVOLUTION_API_URL / EVOLUTION_API_KEY).
          </p>
        ) : wa.connected ? (
          <Button variant="outline" onClick={desconectarWhatsapp} disabled={waBusy}>
            {waBusy ? 'Desconectando…' : 'Desconectar WhatsApp'}
          </Button>
        ) : (
          <Button onClick={conectarWhatsapp} disabled={waBusy}>
            {waBusy ? 'Gerando QR code…' : 'Conectar WhatsApp'}
          </Button>
        )}
        {waError && <p className="mt-2 rounded-menuzia border border-danger bg-danger-bg px-3 py-2 text-[12px] text-danger">{waError}</p>}
      </Card>

      {/* Drawer/overlay do QR — não polui o card. */}
      {qrAberto && wa && !wa.connected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setQrAberto(false)}>
          <div className="w-full max-w-sm rounded-menuzia bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-4.5 py-3.5">
              <div className="flex items-center gap-2">
                <WhatsAppIcon className="h-5 w-5 flex-shrink-0" />
                <h3 className="text-[15px] font-bold">Conectar WhatsApp</h3>
              </div>
              <button onClick={() => setQrAberto(false)} className="flex h-[28px] w-[28px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
            </div>
            <div className="p-4.5">
              {waQr ? (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={waQr.startsWith('data:') ? waQr : `data:image/png;base64,${waQr}`}
                    alt="QR code para conectar o WhatsApp"
                    className="h-52 w-52 rounded-menuzia border border-border"
                  />
                  {waPairingCode && <p className="text-[12px] text-text-subtle">Código de pareamento: <span className="font-mono font-semibold">{waPairingCode}</span></p>}
                  <p className="text-[12px] leading-relaxed text-text-subtle">
                    No celular da loja, abra o WhatsApp em <strong>Aparelhos conectados → Conectar um aparelho</strong> e escaneie o QR code acima.
                    A página atualiza automaticamente quando conectar.
                  </p>
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-text-subtle">Gerando QR code…</p>
              )}
              {waError && <p className="mt-2 rounded-menuzia border border-danger bg-danger-bg px-3 py-2 text-[12px] text-danger">{waError}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Facebook Pixel ───────────────────────────────────────────────────────────

function FacebookPixelCard({ restauranteId }: { restauranteId: string }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [pixelId, setPixelId] = useState('')
  const [salvo, setSalvo] = useState('')
  const [editando, setEditando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setPixelId(c.facebookPixelId ?? '')
      setSalvo((c.facebookPixelId ?? '').trim())
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  async function save() {
    setSaving(true)
    setError(null)
    const valor = pixelId.trim()
    try {
      await atualizarConfigLoja(supabase, restauranteId, { facebookPixelId: valor || null })
      setSalvo(valor)
      setPixelId(valor)
      setEditando(false)
    } catch {
      setError('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const ativo = loaded && salvo !== ''
  const readOnly = ativo && !editando

  return (
    <Card className="flex flex-col">
      <div className="mb-0.5 flex items-center gap-2">
        <FacebookIcon className="h-5 w-5 flex-shrink-0" />
        <h3 className="text-[13px] font-bold text-text-main">Facebook Pixel</h3>
        {ativo && <StatusPill ativo labelAtivo="Ativo" />}
      </div>
      <p className="mb-3 flex-1 text-[12px] leading-relaxed text-text-subtle">
        Rastreie visualizações, adições ao carrinho e pedidos concluídos no cardápio da sua loja.
        Cada loja tem seu próprio Pixel — o código é injetado apenas no cardápio público desta loja.
      </p>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pixel ID</label>
      {readOnly ? (
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-primary-dark">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{salvo}</span>
          </span>
          <Button variant="outline" onClick={() => setEditando(true)}>Editar</Button>
        </div>
      ) : (
        <>
          <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="Ex: 1234567890123456" />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" onClick={save} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
            {editando && (
              <Button variant="ghost" onClick={() => { setPixelId(salvo); setEditando(false); setError(null) }} disabled={saving}>
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
    </Card>
  )
}

// ─── Google Tag ───────────────────────────────────────────────────────────────

function GoogleTagCard({ restauranteId }: { restauranteId: string }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [tagId, setTagId] = useState('')
  const [salvo, setSalvo] = useState('')
  const [editando, setEditando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setTagId(c.googleTagId ?? '')
      setSalvo((c.googleTagId ?? '').trim())
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  async function save() {
    setSaving(true)
    setError(null)
    const valor = tagId.trim()
    try {
      await atualizarConfigLoja(supabase, restauranteId, { googleTagId: valor || null })
      setSalvo(valor)
      setTagId(valor)
      setEditando(false)
    } catch {
      setError('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const ativo = loaded && salvo !== ''
  const readOnly = ativo && !editando

  return (
    <Card className="flex flex-col">
      <div className="mb-0.5 flex items-center gap-2">
        <GoogleIcon className="h-5 w-5 flex-shrink-0" />
        <h3 className="text-[13px] font-bold text-text-main">Google Tag (GA4 / GTM)</h3>
        {ativo && <StatusPill ativo labelAtivo="Ativo" />}
      </div>
      <p className="mb-3 flex-1 text-[12px] leading-relaxed text-text-subtle">
        Insira o ID de medição do Google Analytics 4 (<code className="rounded bg-page px-1 text-[11px]">G-XXXXXXXXXX</code>) ou o ID do
        Google Tag Manager (<code className="rounded bg-page px-1 text-[11px]">GTM-XXXXXX</code>).
        O snippet é injetado no &lt;head&gt; do cardápio público desta loja.
      </p>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Tag ID</label>
      {readOnly ? (
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-primary-dark">
            <ShieldCheck className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">{salvo}</span>
          </span>
          <Button variant="outline" onClick={() => setEditando(true)}>Editar</Button>
        </div>
      ) : (
        <>
          <Input value={tagId} onChange={(e) => setTagId(e.target.value)} placeholder="Ex: G-ABC123XYZ ou GTM-XXXXXX" />
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" onClick={save} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
            {editando && (
              <Button variant="ghost" onClick={() => { setTagId(salvo); setEditando(false); setError(null) }} disabled={saving}>
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
    </Card>
  )
}

// ─── Nexta (outros sistemas) ──────────────────────────────────────────────────

function NextaCard() {
  const [nextaAtivo, setNextaAtivo] = useState(false)

  useEffect(() => {
    fetch('/api/admin/nexta/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { ativo: boolean } | null } | null) => setNextaAtivo(Boolean(d?.config?.ativo)))
      .catch(() => setNextaAtivo(false))
  }, [])

  return (
    <Link
      href="/admin/integracoes/nexta"
      className="group flex items-center gap-5 rounded-menuzia border border-border bg-white p-5 transition-colors hover:border-primary"
    >
      {/* Painel branco com a logo */}
      <div className="flex h-24 w-40 flex-shrink-0 items-center justify-center rounded-menuzia border border-border bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/integracoes/nexta-logo.png" alt="Nexta Delivery" className="max-h-full max-w-full object-contain" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-[15px] font-bold text-text-main">Nexta Delivery</h3>
          <StatusPill ativo={nextaAtivo} labelAtivo="Ativo" labelInativo="Inativo" />
        </div>
        <p className="text-[12px] leading-relaxed text-text-subtle">
          Rede de motoboys terceirizada — vira uma opção de entregador no despacho, com preço e ETA cotados na hora.
        </p>
      </div>

      <ChevronRight className="h-5 w-5 flex-shrink-0 text-text-subtle transition-colors group-hover:text-primary" />
    </Link>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then(setRestauranteId)
  }, [supabase])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Integrações" breadcrumb="Integrações" />

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-[1040px] space-y-8">
          {/* Seção 1 — Integrações do app */}
          <section>
            <SectionTitle>Integrações do app</SectionTitle>
            {!restauranteId ? (
              <p className="text-sm text-text-subtle">Carregando…</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <WhatsAppCard />
                <FacebookPixelCard restauranteId={restauranteId} />
                <GoogleTagCard restauranteId={restauranteId} />
              </div>
            )}
          </section>

          {/* Seção 2 — Outros sistemas */}
          <section>
            <SectionTitle>Outros sistemas</SectionTitle>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <NextaCard />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
