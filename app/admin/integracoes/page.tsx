'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronRight, Lightbulb, Loader2, Plus } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { ModalCentral } from '@/components/ui/flutuante'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja, atualizarConfigLoja } from '@/lib/queries/ajustes'
import { validarGoogleTag, validarPixelFacebook } from '@/lib/pixels'
import { MetaCapiCard } from '@/components/admin/meta-capi-card'
import { MercadoPagoCard } from '@/components/admin/mercadopago-card'
import { CartaoPixel, Selo } from '@/components/admin/integracoes/cartao-pixel'
import { SUPORTE_MENUZIA } from '@/lib/suporte'

/**
 * Integrações (repaginada em 2026-10-06, no modelo do dono — integracoes-modelo.png): faixa "Sentiu falta de
 * alguma integração?", seções com título e cards brancos (logo, nome e ">") em grade de 3 colunas.
 *
 * - Ativas no topo (o que a loja já ligou/conectou), com o selo "Ativa"; Disponíveis embaixo, por tipo.
 *   Disponível não é erro: sem aviso vermelho/amarelo.
 * - Só integrações que existem de verdade. O Mercado Pago só aparece na loja com o Pix online liberado.
 * - Clicar abre a configuração que já existia (na janela central); a Nexta tem página própria.
 * - Integrações é só CONECTAR. O robô de atendimento foi para Ajustes; os números e quem aguarda
 *   atendente ficam só na central do WhatsApp (canto inferior direito).
 */

type IdIntegracao = 'whatsapp' | 'mercadopago' | 'facebook' | 'capi' | 'google' | 'nexta'
type Grupo = 'Mensagens' | 'Pagamentos' | 'Marketing e medição' | 'Entregas'
interface Definicao { id: IdIntegracao; nome: string; grupo: Grupo; logo: string; resumo: string }

const INTEGRACOES: Definicao[] = [
  { id: 'whatsapp', nome: 'WhatsApp', grupo: 'Mensagens', logo: '/icons/integracoes/whatsapp-icon.svg', resumo: 'Avisos do pedido e atendimento pelo WhatsApp da loja.' },
  { id: 'mercadopago', nome: 'Mercado Pago', grupo: 'Pagamentos', logo: '/icons/integracoes/mercado-pago.svg', resumo: 'Pix online: o cliente paga na hora pelo QR.' },
  { id: 'facebook', nome: 'Facebook Pixel', grupo: 'Marketing e medição', logo: '/icons/integracoes/facebook.svg', resumo: 'Mede o cardápio para os anúncios do Facebook e do Instagram.' },
  { id: 'capi', nome: 'API de Conversões (Meta)', grupo: 'Marketing e medição', logo: '/icons/integracoes/meta-icon.svg', resumo: 'Manda a compra pelo servidor, com o mesmo código do pixel.' },
  { id: 'google', nome: 'Google Analytics / Tag Manager', grupo: 'Marketing e medição', logo: '/icons/integracoes/google-analytics.svg', resumo: 'Google Analytics 4 (G-…) ou Tag Manager (GTM-…).' },
  { id: 'nexta', nome: 'Nexta Delivery', grupo: 'Entregas', logo: '/integracoes/nexta-icone.png', resumo: 'Rede de motoboys terceirizada no despacho.' },
]
const ORDEM_GRUPOS: Grupo[] = ['Mensagens', 'Pagamentos', 'Marketing e medição', 'Entregas']

interface WaStatus { configurado: boolean; connected: boolean; state: string | null; numero?: string | null }
interface Situacao {
  wa: WaStatus | null
  waFalhou: boolean
  pixels: { facebook: string; google: string } | null
  capi: boolean | null
  mp: { liberada: boolean; conectada: boolean } | null
  nexta: boolean | null
}

const FONTE_MODELO = { fontFamily: 'var(--font-submenu), var(--font-painel), system-ui, sans-serif' }

/** Card do modelo: logo à esquerda, nome e a seta ">" à direita. */
function CardIntegracao({ def, ativa, onAbrir }: { def: Definicao; ativa: boolean; onAbrir: () => void }) {
  const conteudo = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={def.logo} alt="" width={48} height={48} className="h-[48px] w-[48px] flex-shrink-0 object-contain" />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[16.5px] font-medium leading-[22px] text-[#374151]">{def.nome}</span>
        {ativa && <span className="mt-[4px] inline-flex items-center rounded-full bg-[#ECFDF5] px-[8px] py-[1px] text-[12px] font-semibold text-[#047857]" data-testid={`integracao-${def.id}-ativa`}>Ativa</span>}
      </span>
      <ChevronRight className="h-[22px] w-[22px] flex-shrink-0 text-[#9CA3AF] transition-colors group-hover:text-[#4B5563]" strokeWidth={2} />
    </>
  )
  const classe = 'group flex min-h-[88px] w-full items-center gap-[18px] rounded-[6px] border border-[#E5E7EB] bg-white px-[20px] py-[16px] text-left transition-[border-color,box-shadow] hover:border-[#C9CED6] hover:shadow-[0_2px_8px_rgba(16,24,40,0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B7BC8]'
  return def.id === 'nexta'
    ? <Link href="/admin/integracoes/nexta" className={classe} data-testid={`integracao-${def.id}`} data-ativa={ativa ? 'sim' : 'nao'}>{conteudo}</Link>
    : <button type="button" onClick={onAbrir} className={classe} data-testid={`integracao-${def.id}`} data-ativa={ativa ? 'sim' : 'nao'}>{conteudo}</button>
}

/** Título da janela: o logo e o nome da integração. */
function TituloJanela({ def }: { def: Definicao }) {
  return (
    <span className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={def.logo} alt="" className="h-[26px] w-[26px] object-contain" />
      {def.nome}
    </span>
  )
}

function Secao({ titulo, children, testid }: { titulo: string; children: React.ReactNode; testid?: string }) {
  return (
    <section data-testid={testid}>
      <h2 className="mb-[16px] text-[19px] font-semibold leading-[26px] text-[#4B5563]">{titulo}</h2>
      <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  )
}

/** WhatsApp em Integrações: SÓ conectar — QR, "Conectado" + número e "Desconectar". Nada do robô. */
function ConexaoWhatsapp({ wa, falhou, onMudou }: { wa: WaStatus | null; falhou: boolean; onMudou: () => Promise<WaStatus | null> }) {
  const [qr, setQr] = useState<string | null>(null)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)

  // Com o QR na tela, confere a cada 3 s se já conectou.
  useEffect(() => {
    if (!qr) return
    const t = setInterval(async () => { const d = await onMudou(); if (d?.connected) { setQr(null); setCodigo(null) } }, 3000)
    return () => clearInterval(t)
  }, [qr, onMudou])

  async function conectar() {
    setOcupado(true); setErro(null)
    try {
      const r = await fetch('/api/admin/whatsapp/conectar', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'erro')
      setQr(j.base64 ?? null); setCodigo(j.pairingCode ?? null)
    } catch {
      setErro('Não foi possível gerar o QR code. Tente de novo em instantes.')
    } finally { setOcupado(false) }
  }
  async function desconectar() {
    setOcupado(true); setErro(null)
    try { await fetch('/api/admin/whatsapp/desconectar', { method: 'POST' }); setQr(null); await onMudou() } finally { setOcupado(false); setConfirmar(false) }
  }

  if (wa === null && !falhou) return <p className="flex items-center gap-2 py-6 text-[14px] text-[#4B5563]"><Loader2 className="h-4 w-4 animate-spin" /> Verificando a conexão…</p>
  if (falhou || (wa && !wa.configurado)) {
    return <p className="flex items-start gap-2 text-[14px] text-[#B91C1C]"><AlertTriangle className="mt-[2px] h-4 w-4 flex-shrink-0" /> {falhou ? 'Não foi possível verificar a conexão agora.' : 'Servidor sem a Evolution API configurada. Fale com o suporte da Menuzia.'}</p>
  }
  if (wa!.connected) {
    return (
      <div className="space-y-4" data-testid="whatsapp-conectado">
        <div className="flex flex-wrap items-center gap-3">
          <Selo status="ok" testid="whatsapp-status">Conectado</Selo>
          <span className="text-[15px] font-semibold tabular-nums text-[#111827]" data-testid="whatsapp-numero">{wa!.numero ?? 'Número da loja'}</span>
        </div>
        {confirmar ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-[#FEF2F2] px-3 py-2.5 text-[14px] text-[#991B1B]">
            <span className="min-w-0 flex-1">Desconectar o WhatsApp? Os avisos de pedido param.</span>
            <button type="button" disabled={ocupado} onClick={() => void desconectar()} className="rounded-[8px] bg-[#B91C1C] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50" data-testid="whatsapp-desconectar-confirmar">Desconectar</button>
            <button type="button" onClick={() => setConfirmar(false)} className="rounded-[8px] border border-[#D1D5DB] bg-white px-3.5 py-2 text-[13px] font-semibold text-[#1F2937]">Cancelar</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} className="rounded-[8px] border border-[#D1D5DB] bg-white px-4 py-2 text-[14px] font-semibold text-[#1F2937] hover:border-[#B91C1C] hover:text-[#B91C1C]" data-testid="whatsapp-desconectar">Desconectar</button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-4" data-testid="whatsapp-desconectado">
      {qr ? (
        <div className="flex flex-col items-center gap-3 text-center" data-testid="whatsapp-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR code para conectar o WhatsApp" className="h-[220px] w-[220px] rounded-[8px] border border-[#E5E7EB]" />
          {codigo && <p className="text-[13px] text-[#4B5563]">Código de pareamento: <span className="font-mono font-semibold">{codigo}</span></p>}
          <p className="max-w-[360px] text-[14px] leading-[20px] text-[#4B5563]">No celular da loja, abra o WhatsApp em <b className="font-semibold">Aparelhos conectados → Conectar um aparelho</b> e leia o QR code. Esta janela atualiza sozinha quando conectar.</p>
        </div>
      ) : (
        <>
          <p className="text-[14px] leading-[20px] text-[#4B5563]">Conecte o WhatsApp da loja para mandar os avisos do pedido e atender os clientes pelo painel.</p>
          <button type="button" disabled={ocupado} onClick={() => void conectar()} className="inline-flex w-full items-center justify-center gap-2 rounded-[8px] bg-[#0688D4] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#0570AE] disabled:opacity-60" data-testid="whatsapp-conectar">
            {ocupado ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando QR code…</> : 'Conectar WhatsApp'}
          </button>
        </>
      )}
      {erro && <p className="text-[13px] text-[#B91C1C]">{erro}</p>}
    </div>
  )
}

export default function IntegracoesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const toasts = useToasts()
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [sit, setSit] = useState<Situacao>({ wa: null, waFalhou: false, pixels: null, capi: null, mp: null, nexta: null })
  const [aberta, setAberta] = useState<IdIntegracao | null>(null)

  useEffect(() => { buscarRestauranteIdDoUsuario(supabase).then(setRestauranteId) }, [supabase])

  const lerWhatsapp = useCallback(async (): Promise<WaStatus | null> => {
    try {
      const r = await fetch('/api/admin/whatsapp/status', { cache: 'no-store' })
      if (!r.ok) throw new Error('status')
      const d: WaStatus = await r.json()
      setSit((s) => {
        if (s.wa && !s.wa.connected && d.connected) toasts.mostrar('ok', 'WhatsApp conectado.')
        return { ...s, wa: d, waFalhou: false }
      })
      return d
    } catch {
      setSit((s) => ({ ...s, waFalhou: true }))
      return null
    }
  }, [toasts])

  const lerOutras = useCallback(async () => {
    const [capi, mp, nexta] = await Promise.all([
      fetch('/api/admin/integracoes/meta-capi', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/admin/pix-online', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/admin/nexta/config').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    setSit((s) => ({
      ...s,
      capi: Boolean(capi?.configurado),
      mp: mp ? { liberada: Boolean(mp.lojaLiberada), conectada: Boolean(mp.conta?.conectada) } : { liberada: false, conectada: false },
      nexta: Boolean(nexta?.config?.ativo),
    }))
  }, [])

  const lerPixels = useCallback(async () => {
    if (!restauranteId) return
    const c = await buscarConfigLoja(supabase, restauranteId).catch(() => null)
    setSit((s) => ({ ...s, pixels: { facebook: (c?.facebookPixelId ?? '').trim(), google: (c?.googleTagId ?? '').trim() } }))
  }, [supabase, restauranteId])

  useEffect(() => { void lerWhatsapp(); void lerOutras() }, [lerWhatsapp, lerOutras])
  useEffect(() => { void lerPixels() }, [lerPixels])
  // Quem conecta pelo celular vê o card subir sem recarregar: confere a cada 30 s e ao voltar para a aba.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void lerWhatsapp() }, 30_000)
    const aoVoltar = () => { if (document.visibilityState === 'visible') { void lerWhatsapp(); void lerOutras() } }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [lerWhatsapp, lerOutras])

  // Atalhos: ?abrir=whatsapp (vindo de Ajustes › Robô) e a volta do Mercado Pago (?mercadopago=…).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const abrir = q.get('abrir') as IdIntegracao | null
    if (abrir && INTEGRACOES.some((i) => i.id === abrir)) setAberta(abrir)
    else if (q.get('mercadopago')) setAberta('mercadopago')
  }, [])

  const ativa: Record<IdIntegracao, boolean> = {
    whatsapp: Boolean(sit.wa?.connected),
    mercadopago: Boolean(sit.mp?.conectada),
    facebook: Boolean(sit.pixels?.facebook),
    capi: Boolean(sit.capi),
    google: Boolean(sit.pixels?.google),
    nexta: Boolean(sit.nexta),
  }
  // Mercado Pago só onde o Pix online foi liberado (mesma regra do card de antes).
  const existentes = INTEGRACOES.filter((i) => i.id !== 'mercadopago' || sit.mp?.liberada)
  const carregando = sit.wa === null && !sit.waFalhou || sit.pixels === null || sit.mp === null
  const ativas = existentes.filter((i) => ativa[i.id])
  const disponiveis = existentes.filter((i) => !ativa[i.id])

  async function salvarPixel(campo: 'facebookPixelId' | 'googleTagId', valor: string | null) {
    if (!restauranteId) throw new Error('sem loja')
    await atualizarConfigLoja(supabase, restauranteId, { [campo]: valor })
    await lerPixels()
  }

  function fechar() {
    setAberta(null)
    // Fechou a janela: atualiza tudo para o card ir para o lugar certo (Ativas ou Disponíveis).
    void lerWhatsapp(); void lerOutras(); void lerPixels()
    const u = new URL(window.location.href)
    if (u.searchParams.has('abrir') || u.searchParams.has('mercadopago')) { u.searchParams.delete('abrir'); u.searchParams.delete('mercadopago'); window.history.replaceState(window.history.state, '', u.toString()) }
  }

  const def = aberta ? INTEGRACOES.find((i) => i.id === aberta)! : null
  const linkSugestao = `https://wa.me/${SUPORTE_MENUZIA.whatsapp}?text=${encodeURIComponent('Gostaria de sugerir a integração: ')}`

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Integrações" breadcrumb="Integrações" />

      <div className="flex-1 overflow-y-auto bg-white" style={FONTE_MODELO}>
        <div className="w-full space-y-[32px] px-4 pb-16 pt-5 sm:px-6 lg:px-7" data-testid="pagina-integracoes">
          {/* Faixa do modelo */}
          <div className="flex flex-wrap items-center gap-x-[18px] gap-y-3 rounded-[6px] border border-[#5AA9E6] bg-[#EFF7FD] px-[20px] py-[16px]" data-testid="faixa-sugerir">
            <Lightbulb className="h-[30px] w-[30px] flex-shrink-0 text-[#1F6FB2]" strokeWidth={1.8} />
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-medium leading-[24px] text-[#374151]">Sentiu falta de alguma integração?</p>
              <p className="mt-[2px] text-[14.5px] leading-[20px] text-[#4B5563]">Nos conte quais ferramentas você gostaria de ver integradas ao nosso sistema.</p>
            </div>
            <a href={linkSugestao} target="_blank" rel="noopener noreferrer" data-testid="sugerir-integracao"
              className="inline-flex flex-shrink-0 items-center gap-[8px] rounded-[6px] bg-[#1F6FB2] px-[16px] py-[9px] text-[15px] font-medium text-white hover:bg-[#195E98] max-sm:w-full max-sm:justify-center">
              <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} /> Sugerir integração
            </a>
          </div>

          {carregando ? (
            <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[88px] animate-pulse rounded-[6px] border border-[#E5E7EB] bg-[#F9FAFB]" />)}
            </div>
          ) : (
            <>
              {ativas.length > 0 && (
                <Secao titulo="Integrações ativas" testid="secao-ativas">
                  {ativas.map((d) => <CardIntegracao key={d.id} def={d} ativa onAbrir={() => setAberta(d.id)} />)}
                </Secao>
              )}
              {disponiveis.length > 0 && (
                <div className="space-y-[28px]" data-testid="secao-disponiveis">
                  <p className="-mb-[12px] text-[13px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">Integrações disponíveis</p>
                  {ORDEM_GRUPOS.map((g) => {
                    const doGrupo = disponiveis.filter((d) => d.grupo === g)
                    if (!doGrupo.length) return null
                    return (
                      <Secao key={g} titulo={g}>
                        {doGrupo.map((d) => <CardIntegracao key={d.id} def={d} ativa={false} onAbrir={() => setAberta(d.id)} />)}
                      </Secao>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Configuração da integração: a mesma de antes, numa janela por cima de tudo (flutuante.tsx). */}
      <ModalCentral
        aberto={!!def}
        onFechar={fechar}
        titulo={def ? <TituloJanela def={def} /> : ''}
        subtitulo={def?.resumo}
        largura={def?.id === 'mercadopago' || def?.id === 'capi' ? 720 : 520}
        testid="janela-integracao"
        classeCorpo="p-4 sm:p-5 [&>section]:border-0 [&>section]:p-0 [&>section]:shadow-none"
      >
        {def?.id === 'whatsapp' && <ConexaoWhatsapp wa={sit.wa} falhou={sit.waFalhou} onMudou={lerWhatsapp} />}
        {def?.id === 'facebook' && (
          <CartaoPixel id="facebook" marca="/icons/integracoes/facebook.svg" nome="Facebook Pixel"
            descricao="Mede visualizações, sacola e pedidos do seu cardápio para os anúncios do Facebook e do Instagram. O código vai só no cardápio público desta loja."
            rotuloCampo="Pixel ID" adicionar="Adicionar Pixel ID" placeholder="Ex.: 1234567890123456" validar={validarPixelFacebook}
            valorInicial={sit.pixels?.facebook ?? ''} carregado={!!sit.pixels} onSalvar={(v) => salvarPixel('facebookPixelId', v)} avisar={toasts.mostrar} />
        )}
        {def?.id === 'google' && (
          <CartaoPixel id="google" marca="/icons/integracoes/google-analytics.svg" nome="Google Analytics e Tag Manager"
            descricao={<>Google Analytics 4 (<code className="rounded-[4px] bg-[#F3F4F6] px-1 text-[12px]">G-…</code>) ou Tag Manager (<code className="rounded-[4px] bg-[#F3F4F6] px-1 text-[12px]">GTM-…</code>). O código vai só no cardápio público desta loja.</>}
            rotuloCampo="Tag ID" adicionar="Adicionar Tag ID" placeholder="Ex.: G-ABC123XYZ9 ou GTM-XXXXXXX" validar={validarGoogleTag}
            valorInicial={sit.pixels?.google ?? ''} carregado={!!sit.pixels} onSalvar={(v) => salvarPixel('googleTagId', v)} avisar={toasts.mostrar} />
        )}
        {def?.id === 'capi' && <MetaCapiCard temPixel={!!sit.pixels?.facebook} avisar={(m) => { toasts.mostrar('ok', m); void lerOutras() }} />}
        {def?.id === 'mercadopago' && <MercadoPagoCard avisar={(m) => { toasts.mostrar('ok', m); void lerOutras() }} />}
      </ModalCentral>
      <PilhaToasts itens={toasts.itens} />
    </div>
  )
}
