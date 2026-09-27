'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, ShieldCheck, Plug, Bot, Truck, BarChart3 } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Cartao, SeloStatus, TituloBloco, type EstadoIntegracao } from '@/components/admin/painel-visual'
import { FacebookIcon, GoogleIcon, WhatsAppIcon } from '@/components/ui/brand-icons'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { RoboWhatsappCard } from '@/components/admin/robo-whatsapp'
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
        'w-full rounded-[6px] border border-[var(--adm-borda)] bg-white px-3 py-2.5 font-sans text-sm text-text-main outline-none transition-colors',
        'focus:border-primary placeholder:text-text-subtle/60 disabled:bg-page disabled:text-text-subtle',
        props.className ?? '',
      ].join(' ')}
    />
  )
}

/**
 * Cartão de integração: marca numa bolha, nome, selo de status à direita, descrição curta
 * e a área de ação sempre colada na base (os botões dos três cartões ficam na mesma linha).
 */
function CartaoIntegracao({ marca, nome, estado, rotuloEstado, descricao, children }: {
  marca: React.ReactNode; nome: string; estado: EstadoIntegracao; rotuloEstado?: string; descricao: React.ReactNode; children: React.ReactNode
}) {
  return (
    <Cartao className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-[0.8px] border-[var(--adm-borda)] bg-[#F8FAFC]">{marca}</span>
          <h3 className="min-w-0 text-[14px] font-bold text-[var(--adm-texto)]">{nome}</h3>
        </div>
        <SeloStatus estado={estado} rotulo={rotuloEstado} />
      </div>
      <p className="mt-3 text-[12.5px] leading-[19px] text-[var(--adm-texto-suave)]">{descricao}</p>
      <div className="mt-auto pt-4">{children}</div>
    </Cartao>
  )
}

/** Aviso curto dentro do cartão (sem caixa pesada): ícone + texto em uma cor. */
function AvisoCurto({ tom, children }: { tom: 'erro' | 'alerta'; children: React.ReactNode }) {
  return (
    <p className={`rounded-[6px] px-3 py-2 text-[12px] leading-[17px] ${tom === 'erro' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>{children}</p>
  )
}

function SectionTitle({ children, icone: Icone }: { children: React.ReactNode; icone?: React.ComponentType<{ className?: string }> }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold text-[var(--adm-texto-forte)]">
      {Icone && <Icone className="h-4 w-4 text-[var(--adm-texto-suave)]" />}
      {children}
    </h2>
  )
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

  const estadoWa: EstadoIntegracao =
    wa === null ? 'verificando'
      : !wa.configurado || waError ? 'erro'
        : wa.connected ? 'conectado'
          : qrAberto || wa.state === 'connecting' ? 'aguardando'
            : 'desconectado'

  return (
    <>
      <CartaoIntegracao
        marca={<WhatsAppIcon className="h-5 w-5" />}
        nome="WhatsApp"
        estado={estadoWa}
        rotuloEstado={estadoWa === 'aguardando' ? 'Aguardando QR code' : undefined}
        descricao="Envia ao cliente a confirmação do pedido e os avisos de preparo, pronto e saiu para entrega."
      >
        {wa === null ? (
          <p className="text-[12px] text-[var(--adm-texto-suave)]">Verificando conexão…</p>
        ) : !wa.configurado ? (
          <AvisoCurto tom="erro">Servidor sem a Evolution API configurada. Fale com o suporte da Menuzia.</AvisoCurto>
        ) : wa.connected ? (
          <Button variant="outline" onClick={desconectarWhatsapp} disabled={waBusy} className="w-full">
            {waBusy ? 'Desconectando…' : 'Desconectar WhatsApp'}
          </Button>
        ) : (
          <Button onClick={conectarWhatsapp} disabled={waBusy} className="w-full">
            {waBusy ? 'Gerando QR code…' : 'Conectar WhatsApp'}
          </Button>
        )}
        {waError && <div className="mt-2"><AvisoCurto tom="erro">{waError}</AvisoCurto></div>}
      </CartaoIntegracao>

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
    <CartaoIntegracao
      marca={<FacebookIcon className="h-5 w-5" />}
      nome="Facebook Pixel"
      estado={!loaded ? 'verificando' : error ? 'erro' : ativo ? 'conectado' : 'desconectado'}
      rotuloEstado={loaded && !error ? (ativo ? 'Ativo' : 'Não configurado') : undefined}
      descricao="Mede visualizações, sacola e pedidos do seu cardápio. O código vai só no cardápio público desta loja."
    >
      <label className="mb-1.5 block text-[12px] font-semibold text-[var(--adm-texto-forte)]">Pixel ID</label>
      {readOnly ? (
        <div className="flex items-center justify-between gap-3 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] bg-[#F8FAFC] py-1.5 pl-3 pr-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-[var(--adm-texto)]">
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-[#16A34A]" />
            <span className="truncate">{salvo}</span>
          </span>
          <Button variant="outline" onClick={() => setEditando(true)}>Editar</Button>
        </div>
      ) : (
        <>
          <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="Ex.: 1234567890123456" />
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
      {error && <div className="mt-2"><AvisoCurto tom="erro">{error}</AvisoCurto></div>}
    </CartaoIntegracao>
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
    <CartaoIntegracao
      marca={<GoogleIcon className="h-5 w-5" />}
      nome="Google Tag (GA4 / GTM)"
      estado={!loaded ? 'verificando' : error ? 'erro' : ativo ? 'conectado' : 'desconectado'}
      rotuloEstado={loaded && !error ? (ativo ? 'Ativo' : 'Não configurado') : undefined}
      descricao={<>Google Analytics 4 (<code className="rounded-[3px] bg-[#F1F5F9] px-1 text-[11px]">G-…</code>) ou Tag Manager (<code className="rounded-[3px] bg-[#F1F5F9] px-1 text-[11px]">GTM-…</code>), só no cardápio público desta loja.</>}
    >
      <label className="mb-1.5 block text-[12px] font-semibold text-[var(--adm-texto-forte)]">Tag ID</label>
      {readOnly ? (
        <div className="flex items-center justify-between gap-3 rounded-[6px] border-[0.8px] border-[var(--adm-borda)] bg-[#F8FAFC] py-1.5 pl-3 pr-1.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-[var(--adm-texto)]">
            <ShieldCheck className="h-4 w-4 flex-shrink-0 text-[#16A34A]" />
            <span className="truncate">{salvo}</span>
          </span>
          <Button variant="outline" onClick={() => setEditando(true)}>Editar</Button>
        </div>
      ) : (
        <>
          <Input value={tagId} onChange={(e) => setTagId(e.target.value)} placeholder="Ex.: G-ABC123XYZ ou GTM-XXXXXX" />
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
      {error && <div className="mt-2"><AvisoCurto tom="erro">{error}</AvisoCurto></div>}
    </CartaoIntegracao>
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
      className="group flex items-center gap-4 rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white p-4 transition-colors hover:border-[#0688D4] max-sm:flex-wrap"
    >
      {/* Painel branco com a logo */}
      <div className="flex h-[72px] w-[120px] flex-shrink-0 items-center justify-center rounded-[6px] border-[0.8px] border-[var(--adm-borda)] bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/integracoes/nexta-logo.png" alt="Nexta Delivery" className="max-h-full max-w-full object-contain" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-bold text-[var(--adm-texto)]">Nexta Delivery</h3>
          <SeloStatus estado={nextaAtivo ? 'conectado' : 'desconectado'} rotulo={nextaAtivo ? 'Ativo' : 'Inativo'} />
        </div>
        <p className="text-[12.5px] leading-[19px] text-[var(--adm-texto-suave)]">
          Rede de motoboys terceirizada — vira uma opção de entregador no despacho, com preço e ETA cotados na hora.
        </p>
      </div>

      <ChevronRight className="h-5 w-5 flex-shrink-0 text-[var(--adm-texto-suave)] transition-colors group-hover:text-[#0688D4] max-sm:hidden" />
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

      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="mx-auto max-w-[1180px] space-y-6">
          {/* Cabeçalho da seção: uma linha de contexto, sem caixa pesada. */}
          <Cartao className="flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#E0F2FE] text-[#0688D4]"><Plug className="h-5 w-5" /></span>
            <TituloBloco
              titulo="Conecte a Menuzia às ferramentas que você já usa"
              subtitulo="Cada integração usa as chaves da sua conta. Ligar ou desligar aqui não altera pedidos nem cardápio."
            />
          </Cartao>

          {/* Seção 1 — Integrações do app */}
          <section>
            <SectionTitle icone={BarChart3}>Integrações do app</SectionTitle>
            {!restauranteId ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
                {[0, 1, 2].map((i) => <div key={i} className="h-[200px] animate-pulse rounded-[6px] border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <WhatsAppCard />
                <FacebookPixelCard restauranteId={restauranteId} />
                <GoogleTagCard restauranteId={restauranteId} />
              </div>
            )}
          </section>

          {/* Robô de atendimento do WhatsApp (v1, sem IA) */}
          <section>
            <SectionTitle icone={Bot}>Atendimento no WhatsApp</SectionTitle>
            <RoboWhatsappCard />
          </section>

          {/* Seção 2 — Outros sistemas */}
          <section>
            <SectionTitle icone={Truck}>Outros sistemas</SectionTitle>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <NextaCard />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
