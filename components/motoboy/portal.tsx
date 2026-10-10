'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Lock, Bike, MapPin, Check, PackageCheck, Banknote, CreditCard, QrCode, Ban, WifiOff, Navigation, Menu, User, ChevronRight,
  ChevronLeft, History, ScanLine, RefreshCw, LogOut, Route, X,
} from 'lucide-react'
import { enderecoCompletoPedido, type CaixaEntregador, type Pedido } from '@/lib/queries/pedidos'
import { RouteMap } from '@/components/maps/route-map'
import type { LojaNoMapa } from '@/lib/maps/loja-mapa'
import { mascararTelefoneBR } from '@/lib/telefone'
import { rotuloForma, trocoLevar } from '@/lib/pdv-pagamento'
import { linksGoogleMaps, linkWaze, ordenarParadas, type Coord } from '@/lib/motoboy/rota-paradas'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { LeitorQr } from '@/components/motoboy/leitor-qr'
import { LoginMotoboy } from '@/components/motoboy/login-motoboy'
import { InstalarApp } from '@/components/motoboy/instalar-app'
import { useCoordenadasPedidos } from '@/lib/mapa/cliente'

/**
 * App do motoboy (0136) — o MESMO para o link/QR antigo (`apiBase=/api/entregador/<token>`) e para o
 * login (`apiBase=/api/motoboy`). Com o financeiro da loja ligado, "Entregue" pede como o cliente
 * pagou (dinheiro com troco calculado, cartão com NSU, Pix vai "a conferir", não pago com motivo).
 * O motoboy não confirma Pix nem muda valor: quem decide é o servidor.
 *
 * Sem internet: a ação fica numa fila local e é reenviada ao reconectar, com a MESMA chave (o
 * servidor ignora repetição — nada se duplica).
 *
 * Item 59: tela inicial com os números do dia e três atalhos (Entregas, Histórico, Ler QR Code).
 * "Ler QR Code" lê o QR da comanda de entrega e oferece "Pegar esta entrega?" — quem decide é o
 * servidor (POST <api>/qr); pegar usa a MESMA ação "pegar" do despacho aberto. Várias leituras
 * viram "Abrir rota com N paradas" no Google Maps, na ordem a partir da loja.
 */
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const brlC = (c: number) => brl(c / 100)
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
const enderecoCompleto = enderecoCompletoPedido

type PedidoApp = Pedido & { saiuParaEntregaEm?: string | null; coordenadas?: Coord | null }
interface PortalData {
  entregador: { nome: string; restauranteNome: string; logoUrl?: string | null; fotoUrl?: string | null; status?: string }
  /** Onde a loja fica: o mapa abre nela. */
  loja?: LojaNoMapa | null
  pedidos: PedidoApp[]
  disponiveis: Pedido[]
  despachoAberto: boolean
  concluidosHoje: number
  caixaHoje: CaixaEntregador
  financeiro: { ativo: false } | {
    ativo: true; comigoCentavos: number
    historico: { numero: number | null; forma: string; totalCentavos: number; recebidoCentavos: number | null; trocoDadoCentavos: number | null; em: string }[]
  }
}
interface Pendente { url: string; corpo: Record<string, unknown>; pedidoId: string; rotulo: string }
type Tela = 'inicio' | 'entregas' | 'historico' | 'qr'
interface ResumoQr { id: string; numero: number; cliente: string; bairro: string; endereco: string; total: number; coordenadas?: Coord | null }
type LeituraQr =
  | { situacao: 'pegar'; pedido: ResumoQr }
  | { situacao: 'seu'; pedido: ResumoQr }
  | { situacao: 'bloqueado'; codigo: string; motivo: string; pedido: { numero: number } }
  | { situacao: 'erro'; motivo: string }
  | { situacao: 'pego'; pedido: ResumoQr }

const FILA = 'menuzia-motoboy-fila'
const lerFila = (): Pendente[] => { try { return JSON.parse(localStorage.getItem(FILA) ?? '[]') } catch { return [] } }
const gravarFila = (f: Pendente[]) => { try { localStorage.setItem(FILA, JSON.stringify(f)) } catch { /* sem storage: segue online */ } }

const ROTULO_HIST: Record<string, string> = { dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix (a conferir)', nao_pago: 'Não pago', ja_pago: 'Já pago' }

function resumoItens(p: Pedido): string { return p.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(' · ') }

export function PortalMotoboy({ apiBase, swUrl, swScope }: { apiBase: string; swUrl: string; swScope: string }) {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ texto: string; login?: boolean } | null>(null)
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [fila, setFila] = useState<Pendente[]>([])
  const [pagando, setPagando] = useState<string | null>(null)
  const [naoEntreguei, setNaoEntreguei] = useState<string | null>(null)
  const [tela, setTela] = useState<Tela>('inicio')
  const [menu, setMenu] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  const [leitura, setLeitura] = useState<LeituraQr | null>(null)
  const [lendoQr, setLendoQr] = useState(false)
  const [numeroDigitado, setNumeroDigitado] = useState('')
  const [lidos, setLidos] = useState<number[]>([])
  const enviando = useRef(false)
  const ordemRef = useRef<string[]>([])
  const comLogin = apiBase === '/api/motoboy'

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) { setError({ texto: json.error ?? 'Link inválido', login: res.status === 401 }); return }
      setData(json); setError(null)
    } catch {
      if (!data) setError({ texto: 'Não foi possível carregar suas entregas.' })
    } finally { setLoading(false) }
  }, [apiBase, data])

  // Fila offline: reenvia na ordem, com a mesma chave; o servidor não duplica.
  const esvaziarFila = useCallback(async () => {
    if (enviando.current) return
    enviando.current = true
    try {
      let f = lerFila()
      while (f.length) {
        const item = f[0]
        let r: Response
        try {
          r = await fetch(item.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.corpo) })
        } catch { break }
        if (!r.ok && r.status >= 500) break
        if (!r.ok) { const j = await r.json().catch(() => ({})); setActionError(`#${item.rotulo}: ${j.error ?? 'não foi aceito'}`) }
        f = f.slice(1); gravarFila(f); setFila(f)
      }
    } finally { enviando.current = false; void refetch() }
  }, [refetch])

  useEffect(() => {
    setFila(lerFila()); setOnline(navigator.onLine)
    const on = () => { setOnline(true); void esvaziarFila() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [esvaziarFila])

  useEffect(() => {
    void refetch(); void esvaziarFila()
    const i = setInterval(() => { void refetch(); if (lerFila().length) void esvaziarFila() }, 10000)
    return () => clearInterval(i)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase])

  const atualizarLocalizacao = useCallback(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => setGeo(null), { enableHighAccuracy: true, timeout: 10000 })
  }, [])
  useEffect(() => { atualizarLocalizacao() }, [atualizarLocalizacao])
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register(swUrl, { scope: swScope }).catch(() => {}) }, [swUrl, swScope])
  useEffect(() => {
    const enviar = () => { fetch(`${apiBase}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(geo ?? {}) }).catch(() => {}) }
    enviar(); const i = setInterval(enviar, 30000); return () => clearInterval(i)
  }, [apiBase, geo])

  const lojaCoord: Coord | null = data?.loja && data.loja.lat !== null && data.loja.lng !== null ? { lat: data.loja.lat, lng: data.loja.lng } : null
  const pedidosServidor = data?.pedidos ?? []
  const naFila = new Set(fila.map((f) => f.pedidoId))
  const pedidosBrutos = pedidosServidor.filter((p) => !naFila.has(p.id) || fila.some((f) => f.pedidoId === p.id && f.url.endsWith('/saiu')))
  // Ordem da rota a partir da loja. Só refaz quando ENTRA pedido novo; ao entregar, a ordem que o
  // motoboy já está seguindo continua a mesma.
  const chaveIds = pedidosBrutos.map((p) => p.id).join(',')
  const pedidos = useMemo(() => {
    const porId = new Map(pedidosBrutos.map((p) => [p.id, p]))
    const conhecidos = pedidosBrutos.every((p) => ordemRef.current.includes(p.id))
    if (!conhecidos) {
      ordemRef.current = ordenarParadas(geo ?? lojaCoord, pedidosBrutos.map((p) => ({ id: p.id, endereco: enderecoCompleto(p), coordenadas: p.coordenadas ?? null }))).map((p) => p.id)
    }
    return ordemRef.current.map((id) => porId.get(id)).filter((p): p is PedidoApp => !!p)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveIds, lojaCoord?.lat, lojaCoord?.lng, data])
  const disponiveis = data?.disponiveis ?? []
  const despachoAberto = data?.despachoAberto ?? false
  const fin = data?.financeiro
  // Mapa: coordenadas gravadas no pedido; as que faltam vêm do servidor (/api/mapa/coordenadas), uma vez.
  // O navegador nunca geocodifica nem traça rota no Google (docs/REGRAS-DE-CUSTO.md).
  const tokenMapa = apiBase.startsWith('/api/entregador/') ? decodeURIComponent(apiBase.slice('/api/entregador/'.length).split('/')[0] || '') || null : null
  const semCoord = useMemo(() => pedidos.filter((p) => !p.coordenadas).map((p) => p.id), [pedidos])
  const coordsExtra = useCoordenadasPedidos(semCoord, tokenMapa)
  const routeStops = useMemo(() => pedidos.map((p, i) => {
    const c = p.coordenadas ?? coordsExtra.get(p.id) ?? null
    return { id: p.id, numero: i + 1, address: enderecoCompleto(p), lat: c?.lat ?? null, lng: c?.lng ?? null }
  }), [pedidos, coordsExtra])
  // Item 61: com a localização do celular o Maps sai de onde o motoboy está; sem ela, da loja.
  const origemRota = geo ? null : lojaCoord
  const linksRota = useMemo(() => linksGoogleMaps(origemRota, pedidos.map((p) => ({ id: p.id, endereco: enderecoCompleto(p), coordenadas: p.coordenadas ?? null }))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [pedidos, origemRota?.lat, origemRota?.lng])
  const emRota = pedidos.filter((p) => p.saiuParaEntregaEm).length
  const aguardando = pedidos.length - emRota

  async function enviar(pedido: PedidoApp, acao: string, corpo: Record<string, unknown>, rotuloOffline: string) {
    const url = `${apiBase}/pedidos/${pedido.id}/${acao}`
    setBusy(pedido.id); setActionError(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw Object.assign(new Error(json.error ?? 'Não foi possível concluir'), { http: true })
      setPagando(null); setNaoEntreguei(null)
      await refetch()
    } catch (err) {
      if ((err as { http?: boolean }).http) { setActionError((err as Error).message); return }
      // Sem internet: guarda e reenvia depois (mesma chave).
      const f = [...lerFila(), { url, corpo, pedidoId: pedido.id, rotulo: `${pedido.numero} ${rotuloOffline}` }]
      gravarFila(f); setFila(f); setPagando(null); setNaoEntreguei(null)
    } finally { setBusy(null) }
  }

  async function pegarPedido(pedidoId: string, via: 'lista' | 'qr' = 'lista'): Promise<boolean> {
    setBusy(pedidoId); setActionError(null)
    try {
      const res = await fetch(`${apiBase}/pedidos/${pedidoId}/pegar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ via }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível pegar o pedido')
      await refetch()
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível pegar o pedido'
      if (via === 'qr') setLeitura({ situacao: 'erro', motivo: msg }); else setActionError(msg)
      return false
    } finally { setBusy(null) }
  }

  // Leu um QR (ou digitou o número): o servidor diz se pode pegar, se já é dele ou por que não.
  const lerQr = useCallback(async (texto: string) => {
    if (lendoQr) return
    setLendoQr(true); setLeitura(null)
    try {
      const res = await fetch(`${apiBase}/qr`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setLeitura({ situacao: 'erro', motivo: json.error ?? 'Não foi possível ler este QR.' }); return }
      setLeitura(json as LeituraQr)
      if (json.situacao === 'seu') setLidos((l) => (l.includes(json.pedido.numero) ? l : [...l, json.pedido.numero]))
    } catch {
      setLeitura({ situacao: 'erro', motivo: 'Sem internet: leia de novo quando a conexão voltar.' })
    } finally { setLendoQr(false) }
  }, [apiBase, lendoQr])

  // /r/<código> lido pela câmera do celular com o app logado chega como /motoboy?qr=<código>.
  const qrDaUrl = useRef(false)
  useEffect(() => {
    if (qrDaUrl.current || !data) return
    const codigo = new URLSearchParams(window.location.search).get('qr')
    if (!codigo) return
    qrDaUrl.current = true
    window.history.replaceState(null, '', window.location.pathname)
    setTela('qr'); void lerQr(codigo)
  }, [data, lerQr])

  async function confirmarPegar(p: ResumoQr) {
    if (await pegarPedido(p.id, 'qr')) {
      setLeitura({ situacao: 'pego', pedido: p })
      setLidos((l) => (l.includes(p.numero) ? l : [...l, p.numero]))
    }
  }

  async function atualizar() {
    setAtualizando(true)
    await esvaziarFila()
    await refetch()
    atualizarLocalizacao()
    setAtualizando(false)
  }

  async function sair() {
    await fetch('/api/sessao/sair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motivo: 'saiu' }) }).catch(() => {})
    await getBrowserSupabase().auth.signOut().catch(() => {})
    window.location.href = comLogin ? '/motoboy' : '/login'
  }

  function ir(t: Tela) { setTela(t); setMenu(false); setActionError(null); if (t !== 'qr') setLeitura(null); window.scrollTo(0, 0) }

  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-page text-sm text-text-subtle">Carregando sua rota…</div>
  if (error?.login && comLogin) return <LoginMotoboy onEntrou={() => { setLoading(true); void refetch() }} />
  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-6">
        <div className="w-full max-w-sm rounded-menuzia border border-border bg-white p-5 text-center" data-testid="motoboy-erro">
          <h1 className="text-sm font-semibold text-danger">{error?.login ? 'Entre com o seu login' : comLogin ? 'Acesso não liberado' : 'Link inválido'}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-subtle">{error?.texto ?? 'Não encontramos sua rota.'}</p>
          {error?.login && <a href="/login" className="mt-3 inline-block rounded-menuzia bg-primary px-4 py-2 text-[12px] font-semibold uppercase text-white">Entrar</a>}
        </div>
      </div>
    )
  }

  const avisos = (
    <>
      {(!online || fila.length > 0) && (
        <div className="mb-3 flex items-start gap-2 rounded-menuzia border border-warn/50 bg-warn-bg px-3.5 py-2.5 text-[13px] font-medium text-[#92400E]" data-testid="motoboy-offline">
          <WifiOff className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{!online ? 'Sem internet.' : 'Enviando…'} {fila.length > 0 && `${fila.length} ação(ões) guardada(s) — enviamos assim que a conexão voltar.`}</span>
        </div>
      )}
      {/* PWA (10/10): instalar o Menuzia Entregador — só no app com login. */}
      {!tokenMapa && <InstalarApp />}
      {/* Link mágico (sem senha) sai de cena (10/10): vale até o 1º login com senha e no máximo até 17/10 (lib/motoboy/link-magico.ts). */}
      {tokenMapa && (
        <div className="mb-3 rounded-menuzia border border-warn/50 bg-warn-bg px-3.5 py-2.5 text-[13px] font-medium text-[#92400E]" data-testid="motoboy-aviso-link">
          Peça seu login e senha ao restaurante. Em breve este link deixa de funcionar.
        </div>
      )}
      {data.entregador.status === 'offline' && (
        <div className="mb-3 rounded-menuzia border border-warn/50 bg-warn-bg px-3.5 py-2.5 text-[13px] font-medium text-[#92400E]" data-testid="motoboy-pausado">
          Você está pausado na loja. Peça ao operador para te colocar como Disponível.
        </div>
      )}
      {actionError && <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger" data-testid="motoboy-erro-acao">{actionError}</div>}
    </>
  )

  const botaoRota = pedidos.length > 0 && (
    <div className="flex flex-col gap-2">
      {linksRota.map((href, i) => (
        <a key={href} href={href} target="_blank" rel="noreferrer" data-testid={i === 0 ? 'motoboy-abrir-rota' : `motoboy-abrir-rota-${i + 1}`}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-menuzia bg-primary px-4 text-[15px] font-semibold text-white">
          <Route className="h-5 w-5" />
          {linksRota.length === 1
            ? `Abrir rota completa (${pedidos.length} parada${pedidos.length > 1 ? 's' : ''})`
            : `Abrir rota — parte ${i + 1} de ${linksRota.length}`}
        </a>
      ))}
      {linksRota.length > 1 && <p className="text-center text-[12px] text-text-subtle">O Google Maps aceita até 10 paradas por vez: abra a parte seguinte ao terminar a anterior.</p>}
    </div>
  )

  const cabecalhoSecao = (titulo: string) => (
    <div className="mb-3 flex items-center gap-2">
      <button type="button" onClick={() => ir('inicio')} aria-label="Voltar ao início" data-testid="motoboy-voltar"
        className="flex h-[44px] w-[44px] items-center justify-center rounded-menuzia border border-border bg-white text-text-main">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <h2 className="text-[17px] font-semibold text-text-main">{titulo}</h2>
    </div>
  )

  return (
    <div className="min-h-dvh bg-page pb-10" data-testid="motoboy-app">
      <header className="bg-sidebar-bg px-4 pb-4 pt-3 text-white">
        <div className="mx-auto max-w-[480px]">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu} data-testid="motoboy-menu"
              className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-menuzia bg-white/10">
              {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {data.entregador.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={data.entregador.logoUrl} alt="" className="h-[36px] w-[36px] flex-shrink-0 rounded-menuzia bg-white object-cover" />
                : <span className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-menuzia bg-primary text-[15px] font-semibold">{data.entregador.restauranteNome.slice(0, 1).toUpperCase()}</span>}
              <span className="truncate text-[13px] font-semibold text-[#D1D5DB]">{data.entregador.restauranteNome}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-[110px] truncate text-right text-[14px] font-semibold" data-testid="motoboy-nome">{data.entregador.nome}</span>
              {data.entregador.fotoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={data.entregador.fotoUrl} alt="" className="h-[40px] w-[40px] flex-shrink-0 rounded-full object-cover" />
                : <span className="flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-full bg-white/15"><User className="h-5 w-5" /></span>}
            </div>
          </div>

          {menu && (
            <nav className="mt-3 overflow-hidden rounded-menuzia bg-white text-text-main" data-testid="motoboy-menu-lista">
              {([['inicio', 'Início'], ['entregas', 'Entregas'], ['historico', 'Histórico'], ['qr', 'Ler QR Code']] as [Tela, string][]).map(([t, r]) => (
                <button key={t} type="button" onClick={() => ir(t)} className="flex min-h-[48px] w-full items-center justify-between border-b border-border px-4 text-[15px] font-medium last:border-b-0">
                  {r} <ChevronRight className="h-4 w-4 text-text-subtle" />
                </button>
              ))}
              {comLogin && (
                <button type="button" onClick={() => void sair()} className="flex min-h-[48px] w-full items-center gap-2 px-4 text-[15px] font-semibold text-danger">
                  <LogOut className="h-4 w-4" /> Sair
                </button>
              )}
            </nav>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            {([['Realizadas', data.concluidosHoje, 'motoboy-n-realizadas'], ['Aguardando', aguardando, 'motoboy-n-aguardando'], ['Em rota', emRota, 'motoboy-n-em-rota']] as [string, number, string][]).map(([r, n, id]) => (
              <div key={id} className="rounded-menuzia bg-white/10 px-2 py-2.5 text-center">
                <div className="text-[24px] font-semibold leading-none" data-testid={id}>{n}</div>
                <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#D1D5DB]">{r}</div>
              </div>
            ))}
          </div>
          {fin?.ativo && (
            <div className="mt-2 flex items-center justify-between rounded-menuzia bg-white/10 px-3 py-2.5" data-testid="motoboy-comigo">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-[#D1D5DB]">Dinheiro comigo</span>
              <span className="text-[18px] font-semibold text-[#34D399]">{brlC(fin.comigoCentavos)}</span>
            </div>
          )}
          {!fin?.ativo && data.caixaHoje.recebido > 0 && (
            <div className="mt-2 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#D1D5DB]">Caixa em dinheiro hoje</div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[11px] text-[#D1D5DB]">Recebido</div><div className="text-sm font-semibold">{brl(data.caixaHoje.recebido)}</div></div>
                <div><div className="text-[11px] text-[#D1D5DB]">Troco dado</div><div className="text-sm font-semibold">{brl(data.caixaHoje.trocoDado)}</div></div>
                <div><div className="text-[11px] text-[#D1D5DB]">Devolver</div><div className="text-sm font-semibold text-[#34D399]">{brl(data.caixaHoje.aDevolver)}</div></div>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[480px] px-4 pt-4">
        {avisos}

        {tela === 'inicio' && (
          <div className="flex flex-col gap-3" data-testid="motoboy-inicio">
            {([
              ['entregas', 'Entregas', pedidos.length + (despachoAberto ? disponiveis.length : 0), Bike, 'text-primary', pedidos.length ? `${pedidos.length} na sua rota` : despachoAberto && disponiveis.length ? `${disponiveis.length} para pegar` : 'Nenhuma agora'],
              ['historico', 'Histórico', data.concluidosHoje, History, 'text-[#059669]', 'Entregas de hoje'],
              ['qr', 'Ler QR Code', null, ScanLine, 'text-[#7C3AED]', 'Pegue a entrega pela comanda'],
            ] as [Tela, string, number | null, typeof Bike, string, string][]).map(([t, titulo, n, Icone, cor, sub]) => (
              <button key={t} type="button" onClick={() => ir(t)} data-testid={`motoboy-card-${t}`}
                className="flex min-h-[84px] w-full items-center gap-4 rounded-menuzia border border-border bg-white px-4 text-left shadow-sm active:bg-page">
                <span className="flex h-[48px] w-[48px] flex-shrink-0 items-center justify-center rounded-menuzia bg-page"><Icone className={`h-6 w-6 ${cor}`} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold text-text-main">{titulo}</span>
                  <span className="block truncate text-[13px] text-text-subtle">{sub}</span>
                </span>
                {n !== null && <span className="min-w-[32px] rounded-menuzia bg-page px-2 py-1 text-center text-[16px] font-semibold text-text-main" data-testid={`motoboy-card-${t}-n`}>{n}</span>}
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-text-subtle" />
              </button>
            ))}
            <button type="button" onClick={() => void atualizar()} disabled={atualizando} data-testid="motoboy-atualizar"
              className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-menuzia bg-primary text-[15px] font-semibold text-white disabled:opacity-60">
              <RefreshCw className={`h-5 w-5 ${atualizando ? 'animate-spin' : ''}`} /> {atualizando ? 'Atualizando…' : 'Atualizar'}
            </button>
            {comLogin && (
              <button type="button" onClick={() => void sair()} data-testid="motoboy-sair"
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-menuzia bg-danger text-[15px] font-semibold text-white">
                <LogOut className="h-5 w-5" /> Sair
              </button>
            )}
          </div>
        )}

        {tela === 'qr' && (
          <div data-testid="motoboy-tela-qr">
            {cabecalhoSecao('Ler QR Code')}
            {data.entregador.status !== 'offline' && (
              <LeitorQr onLer={(t) => void lerQr(t)} pausado={lendoQr || !!leitura} />
            )}

            {lendoQr && <p className="mt-3 text-center text-[13px] text-text-subtle">Conferindo o pedido…</p>}
            {leitura && (
              <div className="mt-3" data-testid="motoboy-qr-resultado">
                {leitura.situacao === 'pegar' && (
                  <div className="rounded-menuzia border-2 border-primary bg-white p-4" data-testid="motoboy-qr-pegar-painel">
                    <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">Pegar esta entrega?</p>
                    <p className="mt-1 text-[18px] font-semibold text-text-main">Pedido #{leitura.pedido.numero}</p>
                    <p className="text-[14px] text-text-main">{leitura.pedido.cliente}</p>
                    <p className="mt-1 flex items-start gap-1 text-[13px] text-text-subtle"><MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{leitura.pedido.endereco}</p>
                    <p className="mt-1 text-[14px] font-semibold text-price-text">{brl(leitura.pedido.total)}</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => setLeitura(null)} className="min-h-[52px] rounded-menuzia border border-border bg-white px-4 text-[14px] font-semibold">Cancelar</button>
                      <button type="button" disabled={busy === leitura.pedido.id} onClick={() => void confirmarPegar(leitura.pedido)} data-testid="motoboy-qr-pegar"
                        className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-menuzia bg-status-ready text-[15px] font-semibold text-white disabled:opacity-50">
                        <Bike className="h-5 w-5" /> {busy === leitura.pedido.id ? 'Pegando…' : 'Pegar entrega'}
                      </button>
                    </div>
                  </div>
                )}
                {(leitura.situacao === 'pego' || leitura.situacao === 'seu') && (
                  <div className="rounded-menuzia border border-status-ready bg-price-bg p-4 text-[14px] text-[#065F46]" data-testid="motoboy-qr-ok">
                    <p className="flex items-center gap-2 font-semibold"><Check className="h-5 w-5" />
                      {leitura.situacao === 'pego' ? `Pedido #${leitura.pedido.numero} está com você.` : `O pedido #${leitura.pedido.numero} já está na sua rota.`}
                    </p>
                    <p className="mt-1 text-[13px]">{leitura.pedido.endereco}</p>
                    <div className="mt-3 flex flex-col gap-2" data-testid="motoboy-qr-rotas">
                      <a href={linksGoogleMaps(origemRota, [{ id: leitura.pedido.id, endereco: leitura.pedido.endereco, coordenadas: leitura.pedido.coordenadas ?? null }])[0]} target="_blank" rel="noreferrer" data-testid="motoboy-rota-deste"
                        className="flex min-h-[56px] items-center justify-center gap-2 rounded-menuzia bg-primary px-4 text-[16px] font-semibold text-white">
                        <Navigation className="h-5 w-5" /> Rota deste pedido
                      </a>
                      <button type="button" onClick={() => ir('entregas')} data-testid="motoboy-todas-rotas"
                        className="flex min-h-[56px] items-center justify-center gap-2 rounded-menuzia bg-[#111827] px-4 text-[16px] font-semibold text-white">
                        <Route className="h-5 w-5" /> Todas as rotas
                      </button>
                    </div>
                  </div>
                )}
                {(leitura.situacao === 'bloqueado' || leitura.situacao === 'erro') && (
                  <div className="rounded-menuzia border border-danger bg-danger-bg p-4 text-[14px] font-medium text-danger" role="alert" data-testid="motoboy-qr-bloqueado"
                    data-codigo={leitura.situacao === 'bloqueado' ? leitura.codigo : 'erro'}>
                    {leitura.motivo}
                  </div>
                )}
                {leitura.situacao !== 'pegar' && (
                  <button type="button" onClick={() => setLeitura(null)} data-testid="motoboy-qr-outra"
                    className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-menuzia border border-primary bg-white text-[14px] font-semibold text-primary">
                    <ScanLine className="h-5 w-5" /> Ler outra comanda
                  </button>
                )}
              </div>
            )}

            <form className="mt-4 rounded-menuzia border border-border bg-white p-4" data-testid="motoboy-qr-digitar"
              onSubmit={(e) => { e.preventDefault(); if (numeroDigitado.trim()) void lerQr(numeroDigitado.trim()) }}>
              <label className="text-[13px] font-semibold text-text-main" htmlFor="motoboy-numero">Sem câmera? Digite o número do pedido</label>
              <div className="mt-2 flex gap-2">
                <input id="motoboy-numero" inputMode="numeric" placeholder="Ex.: 172" value={numeroDigitado} onChange={(e) => setNumeroDigitado(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
                  className="h-[48px] min-w-0 flex-1 rounded-menuzia border border-border px-3 text-[16px]" data-testid="motoboy-qr-numero" />
                <button type="submit" disabled={!numeroDigitado || lendoQr} data-testid="motoboy-qr-buscar"
                  className="min-h-[48px] rounded-menuzia bg-primary px-5 text-[14px] font-semibold text-white disabled:opacity-50">Buscar</button>
              </div>
            </form>

            {(lidos.length > 0 || pedidos.length > 0) && (
              <div className="mt-4 space-y-2" data-testid="motoboy-qr-rota">
                {lidos.length > 0 && <p className="text-[13px] text-text-subtle">Lidos agora: {lidos.map((n) => `#${n}`).join(', ')}</p>}
                {botaoRota}
                <button type="button" onClick={() => ir('entregas')} className="flex min-h-[48px] w-full items-center justify-center rounded-menuzia border border-border bg-white text-[14px] font-semibold text-text-main">Ver minhas entregas</button>
              </div>
            )}
          </div>
        )}

        {tela === 'historico' && (
          <div data-testid="motoboy-tela-historico">
            {cabecalhoSecao('Histórico')}
            <div className="rounded-menuzia border border-border bg-white px-4 py-3 text-[14px]">
              <span className="font-semibold">{data.concluidosHoje}</span> entrega{data.concluidosHoje === 1 ? '' : 's'} realizada{data.concluidosHoje === 1 ? '' : 's'} hoje.
            </div>
            {fin?.ativo && fin.historico.length > 0 && (
              <div className="mt-3 rounded-menuzia border border-border bg-white" data-testid="motoboy-historico">
                <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Hoje</div>
                <ul className="divide-y divide-border text-[14px]">
                  {fin.historico.map((h, i) => (
                    <li key={i} className="flex min-h-[44px] items-center justify-between px-3 py-2">
                      <span>#{h.numero} · {ROTULO_HIST[h.forma] ?? h.forma}{h.trocoDadoCentavos ? ` · troco ${brlC(h.trocoDadoCentavos)}` : ''}</span>
                      <span className="font-semibold">{brlC(h.totalCentavos)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tela === 'entregas' && (
        <div data-testid="motoboy-tela-entregas">
        {cabecalhoSecao('Entregas')}
        {routeStops.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Sua rota — paradas na ordem da lista abaixo</div>
            <RouteMap apiKey={MAPS_KEY} origin={geo} stops={routeStops} loja={data.loja} token={tokenMapa} className="h-[220px] w-full" />
            {!geo && (
              <button onClick={atualizarLocalizacao} className="flex w-full items-center justify-center gap-1.5 border-t border-border bg-white py-2 text-xs font-semibold text-primary hover:bg-page">
                Ativar localização para ver a rota a partir de você
              </button>
            )}
          </div>
        )}
        {pedidos.length > 0 && <div className="mb-4">{botaoRota}</div>}

        {pedidos.length > 0 && (
          <div className="flex flex-col gap-3">
            {pedidos.map((order, index) => {
              const liberado = index === 0
              const levar = order.formaPagamento === 'dinheiro' && !order.pago ? trocoLevar(order.total, order.trocoPara) : 0
              const parada = { id: order.id, endereco: enderecoCompleto(order), coordenadas: order.coordenadas ?? null }
              return (
                <div key={order.id} className={`overflow-hidden rounded-menuzia border bg-white ${liberado ? 'border-status-ready' : 'border-border'}`} data-testid={`motoboy-pedido-${order.numero}`}>
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-white">{index + 1}</span>
                      <span className="text-sm font-semibold">Pedido #{order.numero}</span>
                      {order.saiuParaEntregaEm && <span className="rounded-menuzia bg-alert-bg px-1.5 text-[10px] font-semibold uppercase text-alert-text">Saiu</span>}
                    </div>
                    <span className="text-sm font-semibold text-price-text">{brl(order.total)}</span>
                  </div>

                  <div className={`px-4 py-3 ${liberado ? '' : 'opacity-60'}`}>
                    <div className="text-sm font-semibold">{order.clienteNome || 'Cliente'}</div>
                    {order.clienteTelefone && <a href={`tel:${order.clienteTelefone}`} className="mt-0.5 inline-block text-[13px] font-medium text-primary">{mascararTelefoneBR(order.clienteTelefone)}</a>}
                    <div className="mt-2 flex items-start gap-1 text-[13px] leading-relaxed text-text-main">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-subtle" />{enderecoCompleto(order)}
                    </div>
                    {order.observacao && <div className="mt-1 text-[12.5px] text-text-subtle">Obs.: {order.observacao}</div>}
                    <div className="mt-1 flex gap-4">
                      <a href={linksGoogleMaps(null, [parada])[0]} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1 text-[13px] font-semibold text-primary">Google Maps →</a>
                      <a href={linkWaze(parada)} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1 text-[13px] font-semibold text-primary">Waze →</a>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-menuzia bg-alert-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-alert-text">{rotuloForma(order.formaPagamento, order.cartaoTipo)}</span>
                      {!order.pago ? (
                        <span className="rounded-menuzia bg-danger-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-danger">Receber {brl(order.total)}</span>
                      ) : (
                        <span className="rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-price-text" data-testid="entregador-ja-pago">Pago</span>
                      )}
                    </div>
                    {order.formaPagamento === 'dinheiro' && !order.pago && (
                      <div className="mt-2 rounded-menuzia bg-warn-bg px-3 py-2 text-[15px] font-semibold text-[#92400E]" data-testid="motoboy-levar-troco">
                        {levar > 0 ? <>Levar {brl(levar)} de troco <span className="text-[12px] font-semibold">(cliente paga c/ {brl(order.trocoPara!)})</span></> : 'Sem troco'}
                      </div>
                    )}
                    <div className="mt-3 rounded-menuzia border border-border bg-page px-3 py-2 text-[12px] text-text-subtle">{resumoItens(order)}</div>
                  </div>

                  {liberado && pagando === order.id && fin?.ativo ? (
                    <PainelPagamento pedido={order} busy={busy === order.id} onCancelar={() => setPagando(null)}
                      onConfirmar={(corpo) => void enviar(order, 'entregar', { ...corpo, chave: `app:${order.id}` }, 'entregue')} />
                  ) : liberado && naoEntreguei === order.id ? (
                    <NaoEntreguei busy={busy === order.id} onCancelar={() => setNaoEntreguei(null)}
                      onConfirmar={(motivo) => void enviar(order, 'problema', { motivo }, 'não entregue')} />
                  ) : liberado ? (
                    <div className="flex flex-col gap-2 border-t border-border p-3">
                      {!order.saiuParaEntregaEm && (
                        <button onClick={() => void enviar(order, 'saiu', {}, 'saiu')} disabled={busy === order.id} data-testid="motoboy-sai"
                          className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-menuzia border border-primary text-xs font-semibold uppercase tracking-wide text-primary disabled:opacity-50">
                          <Navigation className="h-4 w-4" /> Saí para entrega
                        </button>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setNaoEntreguei(order.id)} disabled={busy === order.id} data-testid="motoboy-nao-entreguei"
                          className="min-h-[52px] rounded-menuzia border border-danger px-3 text-xs font-semibold uppercase tracking-wide text-danger hover:bg-danger-bg disabled:opacity-50">
                          Não consegui
                        </button>
                        <button onClick={() => (fin?.ativo ? setPagando(order.id) : void enviar(order, 'entregar', {}, 'entregue'))} disabled={busy === order.id} data-testid="motoboy-entregue"
                          className="flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-menuzia bg-status-ready text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-50">
                          <Check className="h-4 w-4" /> {busy === order.id ? 'Enviando…' : 'Marcar como entregue'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-1.5 border-t border-border bg-page p-3 text-[12px] font-semibold text-text-subtle">
                      <Lock className="h-3.5 w-3.5" /> Finalize o pedido #{pedidos[index - 1].numero} para liberar
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {despachoAberto && disponiveis.length > 0 && (
          <div className={pedidos.length > 0 ? 'mt-5' : ''}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              <PackageCheck className="h-4 w-4 text-status-pending" /> Disponíveis para pegar
              <span className="rounded-full bg-page px-1.5 text-text-subtle">{disponiveis.length}</span>
            </div>
            <div className="flex flex-col gap-3">
              {disponiveis.map((order) => (
                <div key={order.id} className="overflow-hidden rounded-menuzia border border-border bg-white">
                  <div className="flex items-center justify-between border-b border-border bg-status-pending/5 px-4 py-3">
                    <span className="text-sm font-semibold">Pedido #{order.numero}</span><span className="text-sm font-semibold text-price-text">{brl(order.total)}</span>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-sm font-semibold">{order.clienteNome || 'Cliente'}</div>
                    <div className="mt-1 flex items-start gap-1 text-[13px] leading-relaxed"><MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-subtle" />{enderecoCompleto(order)}</div>
                    <div className="mt-2 text-[12px] font-semibold uppercase text-alert-text">{rotuloForma(order.formaPagamento, order.cartaoTipo)}{order.formaPagamento === 'dinheiro' && order.trocoPara ? ` · troco p/ ${brl(order.trocoPara)}` : ''}</div>
                  </div>
                  <div className="border-t border-border p-3">
                    <button onClick={() => void pegarPedido(order.id)} disabled={busy === order.id || pedidos.length > 0}
                      className="flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-menuzia bg-status-pending text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40">
                      <Bike className="h-4 w-4" /> {busy === order.id ? 'Pegando…' : 'Pegar entrega'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pedidos.length === 0 && disponiveis.length === 0 && (
          <div className="rounded-menuzia border border-dashed border-border bg-white p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-page"><Bike className="h-6 w-6 text-text-subtle" /></div>
            <p className="font-semibold text-text-main">Nenhuma entrega na sua rota agora</p>
            <p className="mt-1 text-[13px] text-text-subtle">{despachoAberto ? 'Assim que a loja liberar um pedido pronto, ele aparece aqui para você pegar.' : 'Quando um pedido for atribuído a você, ele aparece aqui.'}</p>
          </div>
        )}
        </div>
        )}
      </div>
    </div>
  )
}

/** Como o cliente pagou (financeiro ligado). O servidor calcula o troco e recusa recebido menor que o total. */
function PainelPagamento({ pedido, busy, onCancelar, onConfirmar }: {
  pedido: PedidoApp; busy: boolean; onCancelar: () => void; onConfirmar: (c: Record<string, unknown>) => void
}) {
  const jaPago = pedido.pago
  const [forma, setForma] = useState<'dinheiro' | 'cartao' | 'pix' | 'nao_pago' | null>(jaPago ? 'cartao' : pedido.formaPagamento === 'cartao' ? 'cartao' : pedido.formaPagamento === 'pix' ? 'pix' : pedido.formaPagamento === 'dinheiro' ? 'dinheiro' : null)
  const [recebido, setRecebido] = useState(String(pedido.trocoPara ?? pedido.total).replace('.', ','))
  const [nsu, setNsu] = useState('')
  const [motivo, setMotivo] = useState('')
  const recC = Math.round(Number(recebido.replace(/\./g, '').replace(',', '.')) * 100)
  const totC = Math.round(pedido.total * 100)
  const troco = recC - totC
  const erro = forma === 'dinheiro' && !(recC >= totC) ? `O cliente deu menos que ${brl(pedido.total)}.` : forma === 'nao_pago' && motivo.trim().length < 3 ? 'Diga o motivo.' : !forma ? 'Escolha como o cliente pagou.' : null
  const op = (f: typeof forma, rot: string, Icone: typeof Banknote) => (
    <button type="button" onClick={() => setForma(f)} aria-pressed={forma === f} data-testid={`motoboy-pag-${f}`}
      className={`flex min-h-[52px] items-center gap-2 rounded-menuzia border px-3 text-[14px] font-semibold ${forma === f ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-white'}`}>
      <Icone className="h-5 w-5" /> {rot}
    </button>
  )
  if (jaPago) {
    return (
      <div className="space-y-2 border-t border-border p-3" data-testid="motoboy-pagamento">
        <p className="text-[13px] text-text-subtle">Este pedido já foi pago na loja. Só confirme a entrega.</p>
        <div className="flex gap-2">
          <button onClick={onCancelar} className="rounded-menuzia border border-border px-3 py-3 text-xs font-semibold uppercase">Voltar</button>
          <button onClick={() => onConfirmar({ forma: 'cartao' })} disabled={busy} data-testid="motoboy-confirmar-pagamento" className="flex-1 rounded-menuzia bg-status-ready py-3 text-sm font-semibold uppercase text-white disabled:opacity-50">Confirmar entrega</button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2 border-t border-border bg-page p-3" data-testid="motoboy-pagamento">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-text-subtle">Como o cliente pagou?</p>
      <div className="grid grid-cols-2 gap-2">
        {op('dinheiro', 'Dinheiro', Banknote)}{op('cartao', 'Cartão', CreditCard)}{op('pix', 'Pix', QrCode)}{op('nao_pago', 'Não pagou', Ban)}
      </div>
      {forma === 'dinheiro' && (
        <div className="space-y-1">
          <label className="flex h-[44px] items-center rounded-menuzia border border-border bg-white px-2">
            <span className="mr-2 text-[13px] text-text-subtle">Recebi R$</span>
            <input inputMode="decimal" className="h-full w-full bg-transparent text-[16px] font-semibold outline-none" value={recebido} onChange={(e) => setRecebido(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9))} data-testid="motoboy-recebido" />
          </label>
          {troco > 0 && !erro && <p className="text-[15px] font-semibold text-[#92400E]" data-testid="motoboy-troco-dar">Dar de troco: {brlC(troco)}</p>}
        </div>
      )}
      {forma === 'cartao' && <input placeholder="NSU (se tiver)" value={nsu} onChange={(e) => setNsu(e.target.value.slice(0, 40))} className="h-[44px] w-full rounded-menuzia border border-border bg-white px-2 text-[14px]" data-testid="motoboy-nsu" />}
      {forma === 'pix' && <p className="text-[12.5px] text-text-subtle">O Pix fica &quot;a conferir&quot;: a loja confirma quando cair na conta.</p>}
      {forma === 'nao_pago' && <textarea placeholder="Por que não pagou?" value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} className="min-h-[64px] w-full rounded-menuzia border border-border bg-white p-2 text-[14px]" data-testid="motoboy-motivo-nao-pago" />}
      {erro && forma && <p className="text-[12.5px] font-semibold text-danger">{erro}</p>}
      <div className="flex gap-2">
        <button onClick={onCancelar} className="rounded-menuzia border border-border bg-white px-3 py-3 text-xs font-semibold uppercase">Voltar</button>
        <button disabled={busy || !!erro} data-testid="motoboy-confirmar-pagamento"
          onClick={() => onConfirmar({ forma, ...(forma === 'dinheiro' ? { recebidoCentavos: recC } : {}), ...(forma === 'cartao' && nsu ? { nsu } : {}), ...(forma === 'nao_pago' ? { motivo } : {}) })}
          className="flex-1 rounded-menuzia bg-status-ready py-3 text-sm font-semibold uppercase text-white disabled:opacity-50">
          {busy ? 'Enviando…' : 'Confirmar entrega'}
        </button>
      </div>
    </div>
  )
}

function NaoEntreguei({ busy, onCancelar, onConfirmar }: { busy: boolean; onCancelar: () => void; onConfirmar: (motivo: string) => void }) {
  const [motivo, setMotivo] = useState('')
  return (
    <div className="space-y-2 border-t border-border bg-page p-3" data-testid="motoboy-nao-entreguei-painel">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-text-subtle">Por que não conseguiu entregar?</p>
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 300))} placeholder="Cliente não atendeu, endereço errado…" className="min-h-[64px] w-full rounded-menuzia border border-border bg-white p-2 text-[14px]" data-testid="motoboy-motivo" />
      <div className="flex gap-2">
        <button onClick={onCancelar} className="rounded-menuzia border border-border bg-white px-3 py-3 text-xs font-semibold uppercase">Voltar</button>
        <button disabled={busy || motivo.trim().length < 3} onClick={() => onConfirmar(motivo.trim())} data-testid="motoboy-confirmar-nao-entreguei"
          className="flex-1 rounded-menuzia bg-danger py-3 text-sm font-semibold uppercase text-white disabled:opacity-50">Confirmar</button>
      </div>
    </div>
  )
}
