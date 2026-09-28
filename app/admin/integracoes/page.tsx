'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BarChart3, Check, ChevronRight, Copy, Loader2, MessageCircle, Pencil, Truck, X } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { WhatsAppIcon } from '@/components/ui/brand-icons'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { RoboWhatsappCard, type ConexaoWhatsapp } from '@/components/admin/robo-whatsapp'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja, atualizarConfigLoja } from '@/lib/queries/ajustes'
import { validarGoogleTag, validarPixelFacebook, type ResultadoId } from '@/lib/pixels'

/**
 * Integrações (visual novo, 2026-09-28 — mesmo padrão da tela Impressão): cartões brancos
 * com borda cinza clara, uma cor de destaque, ícones de linha nos títulos e as marcas nas
 * cores oficiais. Seções: WhatsApp (conexão + robô), Medição (Meta Pixel e Google Tag,
 * com edição no próprio cartão e validação) e Outros sistemas (Nexta).
 */

interface WaStatus {
  configurado: boolean
  connected: boolean
  state: string | null
  numero?: string | null
}

type Avisar = (tom: 'ok' | 'erro', texto: string) => void

const CARTAO = 'rounded-[12px] border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]'
const BOTAO = 'inline-flex items-center justify-center gap-1.5 rounded-[8px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]'
const PRIMARIO = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
const SECUNDARIO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]`

type Status = 'ok' | 'neutro' | 'alerta' | 'erro' | 'carregando'
function Selo({ status, children, testid }: { status: Status; children: React.ReactNode; testid?: string }) {
  const cor = { ok: 'bg-[#ECFDF5] text-[#047857]', neutro: 'bg-[#F3F4F6] text-[#4B5563]', alerta: 'bg-[#FFFBEB] text-[#92400E]', erro: 'bg-[#FEF2F2] text-[#B91C1C]', carregando: 'bg-[#F3F4F6] text-[#6B7280]' }[status]
  const ponto = { ok: 'bg-[#10B981]', neutro: 'bg-[#9CA3AF]', alerta: 'bg-[#F59E0B]', erro: 'bg-[#EF4444]', carregando: 'bg-[#9CA3AF] animate-pulse' }[status]
  return (
    <span className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-medium ${cor}`} data-testid={testid}>
      <span className={`h-[6px] w-[6px] rounded-full ${ponto}`} aria-hidden />
      {children}
    </span>
  )
}

function TituloSecao({ icone: Icone, titulo, texto }: { icone: React.ComponentType<{ className?: string }>; titulo: string; texto?: string }) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#111827]"><Icone className="h-[18px] w-[18px] text-[#4B5563]" /> {titulo}</h2>
      {texto && <p className="mt-0.5 text-[13px] text-[#6B7280]">{texto}</p>}
    </div>
  )
}

// ─── WhatsApp (conexão) ───────────────────────────────────────────────────────

function WhatsAppCard({ wa, qrAberto, setQrAberto, waQr, waPairingCode, waBusy, waError, onConectar, onDesconectar, cartaoRef }: {
  wa: WaStatus | null
  qrAberto: boolean
  setQrAberto: (v: boolean) => void
  waQr: string | null
  waPairingCode: string | null
  waBusy: boolean
  waError: string | null
  onConectar: () => void
  onDesconectar: () => void
  cartaoRef: React.RefObject<HTMLElement>
}) {
  const [confirmarDesconectar, setConfirmarDesconectar] = useState(false)
  const status: { s: Status; rotulo: string } =
    wa === null ? { s: 'carregando', rotulo: 'Verificando…' }
      : !wa.configurado || waError ? { s: 'erro', rotulo: 'Erro na conexão' }
        : wa.connected ? { s: 'ok', rotulo: 'Conectado' }
          : qrAberto || wa.state === 'connecting' ? { s: 'alerta', rotulo: 'Aguardando QR code' }
            : { s: 'neutro', rotulo: 'Desconectado' }

  return (
    <>
      <section ref={cartaoRef} className={`${CARTAO} flex h-full flex-col p-5 scroll-mt-4`} data-testid="cartao-whatsapp">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <WhatsAppIcon className="h-9 w-9 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-[#111827]">WhatsApp da loja</h3>
              <p className="text-[13px] text-[#6B7280]" data-testid="whatsapp-numero">
                {wa?.connected ? (wa.numero ? `Conectado · ${wa.numero}` : 'Conectado') : 'Nenhum número conectado'}
              </p>
            </div>
          </div>
          <Selo status={status.s} testid="whatsapp-status">{status.rotulo}</Selo>
        </div>
        <p className="mt-3 text-[13px] leading-[19px] text-[#6B7280]">Manda ao cliente a confirmação do pedido e os avisos de preparo, pronto e saiu para entrega.</p>
        <div className="mt-auto pt-4">
          {wa === null ? null : !wa.configurado ? (
            <p className="flex items-start gap-2 text-[13px] text-[#B91C1C]"><AlertTriangle className="mt-[1px] h-4 w-4 flex-shrink-0" /> Servidor sem a Evolution API configurada. Fale com o suporte da Menuzia.</p>
          ) : wa.connected ? (
            confirmarDesconectar ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="text-[#111827]">Desconectar o WhatsApp? Os avisos de pedido param.</span>
                <button type="button" onClick={() => { setConfirmarDesconectar(false); onDesconectar() }} disabled={waBusy} className={`${BOTAO} bg-[#DC2626] text-white hover:bg-[#B91C1C]`}>Desconectar</button>
                <button type="button" onClick={() => setConfirmarDesconectar(false)} className={SECUNDARIO}>Cancelar</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmarDesconectar(true)} disabled={waBusy} className="text-[13px] font-semibold text-[#6B7280] hover:text-[#DC2626]" data-testid="whatsapp-desconectar">
                {waBusy ? 'Desconectando…' : 'Desconectar'}
              </button>
            )
          ) : (
            <button type="button" onClick={onConectar} disabled={waBusy} className={`${PRIMARIO} w-full`} data-testid="whatsapp-conectar">
              {waBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando QR code…</> : 'Conectar WhatsApp'}
            </button>
          )}
          {waError && <p className="mt-2 text-[13px] text-[#B91C1C]">{waError}</p>}
        </div>
      </section>

      {/* Janela do QR — não polui o card. */}
      {qrAberto && wa && !wa.connected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/45 p-4" onClick={() => setQrAberto(false)} role="dialog" aria-modal="true" aria-label="Conectar WhatsApp">
          <div className="w-full max-w-sm rounded-[12px] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3.5">
              <h3 className="flex items-center gap-2 text-[16px] font-semibold"><WhatsAppIcon className="h-5 w-5" /> Conectar WhatsApp</h3>
              <button type="button" onClick={() => setQrAberto(false)} aria-label="Fechar" className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#F3F4F6]"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              {waQr ? (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={waQr.startsWith('data:') ? waQr : `data:image/png;base64,${waQr}`} alt="QR code para conectar o WhatsApp" className="h-52 w-52 rounded-[8px] border border-[#E5E7EB]" />
                  {waPairingCode && <p className="text-[12.5px] text-[#6B7280]">Código de pareamento: <span className="font-mono font-semibold">{waPairingCode}</span></p>}
                  <p className="text-[13px] leading-relaxed text-[#6B7280]">
                    No celular da loja, abra o WhatsApp em <strong>Aparelhos conectados → Conectar um aparelho</strong> e escaneie o QR code. A página atualiza sozinha quando conectar.
                  </p>
                </div>
              ) : (
                <p className="flex items-center justify-center gap-2 py-8 text-[13px] text-[#6B7280]"><Loader2 className="h-4 w-4 animate-spin" /> Gerando QR code…</p>
              )}
              {waError && <p className="mt-2 text-[13px] text-[#B91C1C]">{waError}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Pixels (Meta Pixel e Google Tag) ─────────────────────────────────────────

function CartaoPixel({ id, marca, nome, descricao, rotuloCampo, adicionar, placeholder, validar, valorInicial, carregado, onSalvar, avisar }: {
  id: 'facebook' | 'google'
  marca: string
  nome: string
  descricao: React.ReactNode
  rotuloCampo: string
  adicionar: string
  placeholder: string
  validar: (v: string) => ResultadoId
  valorInicial: string
  carregado: boolean
  onSalvar: (valor: string | null) => Promise<void>
  avisar: Avisar
}) {
  const [salvo, setSalvo] = useState(valorInicial)
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmarRemover, setConfirmarRemover] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setSalvo(valorInicial), [valorInicial])
  useEffect(() => { if (editando) input.current?.focus() }, [editando])

  const ativo = carregado && salvo !== ''
  const invalido = ativo && !validar(salvo).ok

  function abrir() {
    setValor(salvo)
    setErro(null)
    setConfirmarRemover(false)
    setEditando(true)
  }
  function cancelar() {
    setEditando(false)
    setErro(null)
    setConfirmarRemover(false)
  }
  async function gravar(novo: string | null, msgOk: string) {
    setSalvando(true)
    try {
      await onSalvar(novo)
      setSalvo(novo ?? '')
      setEditando(false)
      setConfirmarRemover(false)
      avisar('ok', msgOk)
    } catch {
      avisar('erro', 'Não foi possível salvar. Verifique sua conexão e tente de novo.')
    } finally {
      setSalvando(false)
    }
  }
  async function salvar() {
    const r = validar(valor)
    if (!r.ok) {
      setErro(r.erro)
      input.current?.focus()
      return
    }
    setErro(null)
    await gravar(r.valor, `${nome} salvo.`)
  }

  return (
    <section className={`${CARTAO} flex h-full flex-col p-5`} data-testid={`pixel-${id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={marca} alt="" className="h-9 w-9 flex-shrink-0" />
          <h3 className="min-w-0 text-[15px] font-semibold text-[#111827]">{nome}</h3>
        </div>
        <Selo status={!carregado ? 'carregando' : ativo ? (invalido ? 'alerta' : 'ok') : 'neutro'} testid={`pixel-${id}-status`}>{!carregado ? 'Verificando…' : ativo ? 'Ativo' : 'Não configurado'}</Selo>
      </div>
      <p className="mt-3 text-[13px] leading-[19px] text-[#6B7280]">{descricao}</p>

      <div className="mt-auto pt-4">
        {!carregado ? (
          <div className="h-[36px] animate-pulse rounded-[8px] bg-[#F3F4F6]" />
        ) : editando ? (
          <div>
            <label htmlFor={`campo-${id}`} className="mb-1 block text-[12.5px] font-medium text-[#374151]">{rotuloCampo}</label>
            <input
              id={`campo-${id}`}
              ref={input}
              value={valor}
              onChange={(e) => { setValor(e.target.value); if (erro) setErro(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void salvar() }
                if (e.key === 'Escape') { e.preventDefault(); cancelar() }
              }}
              placeholder={placeholder}
              aria-invalid={!!erro}
              aria-describedby={erro ? `erro-${id}` : undefined}
              data-testid={`pixel-${id}-campo`}
              className={['w-full rounded-[8px] border bg-white px-3 py-2 font-mono text-[14px] tabular-nums text-[#111827] outline-none placeholder:font-sans placeholder:text-[#9CA3AF] focus:border-[#0688D4] focus:ring-2 focus:ring-[#0688D4]/15', erro ? 'border-[#DC2626]' : 'border-[#D1D5DB]'].join(' ')}
            />
            {erro && <p id={`erro-${id}`} className="mt-1.5 text-[12.5px] text-[#B91C1C]" data-testid={`pixel-${id}-erro`}>{erro}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={cancelar} disabled={salvando} className={SECUNDARIO} data-testid={`pixel-${id}-cancelar`}>Cancelar</button>
              <button type="button" onClick={() => void salvar()} disabled={salvando} className={PRIMARIO} data-testid={`pixel-${id}-salvar`}>
                {salvando ? <><Loader2 className="h-4 w-4 animate-spin" /> Salvando…</> : 'Salvar'}
              </button>
              {salvo && !confirmarRemover && (
                <button type="button" onClick={() => setConfirmarRemover(true)} disabled={salvando} className="ml-auto text-[12.5px] font-medium text-[#6B7280] hover:text-[#DC2626]" data-testid={`pixel-${id}-remover`}>Remover</button>
              )}
            </div>
            {confirmarRemover && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[8px] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#991B1B]">
                <span className="min-w-0 flex-1">Remover o {nome}? A medição para no cardápio.</span>
                <button type="button" onClick={() => void gravar(null, `${nome} removido.`)} disabled={salvando} className={`${BOTAO} bg-[#DC2626] text-white hover:bg-[#B91C1C]`} data-testid={`pixel-${id}-remover-confirmar`}>Remover</button>
                <button type="button" onClick={() => setConfirmarRemover(false)} className={SECUNDARIO}>Não</button>
              </div>
            )}
          </div>
        ) : ativo ? (
          <div>
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={marca} alt="" className="h-5 w-5 flex-shrink-0" />
              <span className="min-w-0 truncate font-mono text-[15px] tabular-nums tracking-[0.02em] text-[#111827]" data-testid={`pixel-${id}-valor`}>{salvo}</span>
              <button type="button" onClick={abrir} title="Editar" aria-label={`Editar ${rotuloCampo}`} className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]" data-testid={`pixel-${id}-editar`}>
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => { void navigator.clipboard?.writeText(salvo).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }) }}
                title="Copiar"
                aria-label={`Copiar ${rotuloCampo}`}
                className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]"
              >
                {copiado ? <Check className="h-4 w-4 text-[#059669]" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            {invalido && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[#92400E]" data-testid={`pixel-${id}-invalido`}>
                <AlertTriangle className="h-4 w-4 flex-shrink-0" /> ID parece inválido.
                <button type="button" onClick={abrir} className="font-semibold text-[#0688D4] hover:underline">Corrigir</button>
              </p>
            )}
          </div>
        ) : (
          <button type="button" onClick={abrir} className={SECUNDARIO} data-testid={`pixel-${id}-adicionar`}>{adicionar}</button>
        )}
      </div>
    </section>
  )
}

// ─── Nexta (outros sistemas) ──────────────────────────────────────────────────

function NextaCard() {
  const [nextaAtivo, setNextaAtivo] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/admin/nexta/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: { ativo: boolean } | null } | null) => setNextaAtivo(Boolean(d?.config?.ativo)))
      .catch(() => setNextaAtivo(false))
  }, [])

  return (
    <Link href="/admin/integracoes/nexta" className={`${CARTAO} group flex items-center gap-4 p-5 transition-colors hover:border-[#0688D4] max-sm:flex-wrap`}>
      <div className="flex h-[64px] w-[112px] flex-shrink-0 items-center justify-center rounded-[8px] border border-[#E5E7EB] bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/integracoes/nexta-logo.png" alt="Nexta Delivery" className="max-h-full max-w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold text-[#111827]">Nexta Delivery</h3>
          <Selo status={nextaAtivo === null ? 'carregando' : nextaAtivo ? 'ok' : 'neutro'}>{nextaAtivo === null ? 'Verificando…' : nextaAtivo ? 'Ativo' : 'Inativo'}</Selo>
        </div>
        <p className="text-[13px] leading-[19px] text-[#6B7280]">Rede de motoboys terceirizada — vira uma opção de entregador no despacho, com preço e prazo cotados na hora.</p>
      </div>
      <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#9CA3AF] transition-colors group-hover:text-[#0688D4] max-sm:hidden" />
    </Link>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function IntegracoesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const toasts = useToasts()
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [pixels, setPixels] = useState<{ facebook: string; google: string } | null>(null)

  // WhatsApp: a página guarda a conexão (o robô depende dela).
  const [wa, setWa] = useState<WaStatus | null>(null)
  const [waFalhou, setWaFalhou] = useState(false)
  const [waQr, setWaQr] = useState<string | null>(null)
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null)
  const [waBusy, setWaBusy] = useState(false)
  const [waError, setWaError] = useState<string | null>(null)
  const [qrAberto, setQrAberto] = useState(false)
  const cartaoWa = useRef<HTMLElement>(null)

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then(setRestauranteId)
  }, [supabase])

  useEffect(() => {
    if (!restauranteId) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      setPixels({ facebook: (c?.facebookPixelId ?? '').trim(), google: (c?.googleTagId ?? '').trim() })
    }).catch(() => setPixels({ facebook: '', google: '' }))
  }, [supabase, restauranteId])

  const atualizarStatusWhatsapp = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      if (!res.ok) throw new Error('status')
      const data: WaStatus = await res.json()
      setWa(data)
      setWaFalhou(false)
      if (data.connected) setWaQr(null)
      return data
    } catch {
      setWaFalhou(true)
      return null
    }
  }, [])

  useEffect(() => {
    void atualizarStatusWhatsapp()
  }, [atualizarStatusWhatsapp])

  // Enquanto o QR está na tela, verifica a cada 3s se o WhatsApp já foi conectado.
  useEffect(() => {
    if (!waQr) return
    const interval = setInterval(async () => {
      const data = await atualizarStatusWhatsapp()
      if (data?.connected) { clearInterval(interval); setQrAberto(false); toasts.mostrar('ok', 'WhatsApp conectado.') }
    }, 3000)
    return () => clearInterval(interval)
  }, [waQr, atualizarStatusWhatsapp, toasts])

  async function conectarWhatsapp() {
    cartaoWa.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
      toasts.mostrar('ok', 'WhatsApp desconectado.')
    } finally {
      setWaBusy(false)
    }
  }

  const conexao: ConexaoWhatsapp = waFalhou ? 'falhou' : wa === null ? null : { configurado: wa.configurado, conectado: wa.connected, estado: wa.state }

  async function salvarPixel(campo: 'facebookPixelId' | 'googleTagId', valor: string | null) {
    if (!restauranteId) throw new Error('sem loja')
    await atualizarConfigLoja(supabase, restauranteId, { [campo]: valor })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Integrações" breadcrumb="Integrações" />

      <div className="flex-1 overflow-y-auto bg-[#F6F7F9]">
        <div className="mx-auto w-full max-w-[1240px] space-y-8 p-4 pb-16 lg:p-6" data-testid="pagina-integracoes">
          <p className="text-[13px] text-[#6B7280]">Conecte a Menuzia às ferramentas que você já usa. Ligar ou desligar aqui não altera pedidos nem cardápio.</p>

          <section>
            <TituloSecao icone={MessageCircle} titulo="WhatsApp" texto="Avisos do pedido para o cliente e o robô que responde as mensagens." />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
              <WhatsAppCard
                wa={wa}
                qrAberto={qrAberto}
                setQrAberto={setQrAberto}
                waQr={waQr}
                waPairingCode={waPairingCode}
                waBusy={waBusy}
                waError={waFalhou ? 'Não foi possível verificar a conexão.' : waError}
                onConectar={() => void conectarWhatsapp()}
                onDesconectar={() => void desconectarWhatsapp()}
                cartaoRef={cartaoWa}
              />
              <RoboWhatsappCard conexao={conexao} onConectar={() => void conectarWhatsapp()} avisar={toasts.mostrar} />
            </div>
          </section>

          <section>
            <TituloSecao icone={BarChart3} titulo="Medição" texto="Os códigos vão só no cardápio público desta loja." />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CartaoPixel
                id="facebook"
                marca="/icons/integracoes/meta-pixel.svg"
                nome="Facebook Pixel"
                descricao="Mede visualizações, sacola e pedidos do seu cardápio para os anúncios do Facebook e do Instagram."
                rotuloCampo="Pixel ID"
                adicionar="Adicionar Pixel ID"
                placeholder="Ex.: 1234567890123456"
                validar={validarPixelFacebook}
                valorInicial={pixels?.facebook ?? ''}
                carregado={!!pixels}
                onSalvar={(v) => salvarPixel('facebookPixelId', v)}
                avisar={toasts.mostrar}
              />
              <CartaoPixel
                id="google"
                marca="/icons/integracoes/google-tag-manager.svg"
                nome="Google Tag"
                descricao={<>Google Analytics 4 (<code className="rounded-[4px] bg-[#F3F4F6] px-1 text-[12px]">G-…</code>) ou Tag Manager (<code className="rounded-[4px] bg-[#F3F4F6] px-1 text-[12px]">GTM-…</code>).</>}
                rotuloCampo="Tag ID"
                adicionar="Adicionar Tag ID"
                placeholder="Ex.: G-ABC123XYZ9 ou GTM-XXXXXXX"
                validar={validarGoogleTag}
                valorInicial={pixels?.google ?? ''}
                carregado={!!pixels}
                onSalvar={(v) => salvarPixel('googleTagId', v)}
                avisar={toasts.mostrar}
              />
            </div>
          </section>

          <section>
            <TituloSecao icone={Truck} titulo="Outros sistemas" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <NextaCard />
            </div>
          </section>
        </div>
      </div>
      <PilhaToasts itens={toasts.itens} />
    </div>
  )
}
