'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Bike, MapPin, Check, PackageCheck, Banknote, CreditCard, QrCode, Ban, WifiOff, Navigation } from 'lucide-react'
import { enderecoCompletoPedido, type CaixaEntregador, type Pedido } from '@/lib/queries/pedidos'
import { RouteMap } from '@/components/maps/route-map'
import type { LojaNoMapa } from '@/lib/maps/loja-mapa'
import { mascararTelefoneBR } from '@/lib/telefone'
import { rotuloForma, trocoLevar } from '@/lib/pdv-pagamento'

/**
 * App do motoboy (0136) — o MESMO para o link/QR antigo (`apiBase=/api/entregador/<token>`) e para o
 * login (`apiBase=/api/motoboy`). Com o financeiro da loja ligado, "Entregue" pede como o cliente
 * pagou (dinheiro com troco calculado, cartão com NSU, Pix vai "a conferir", não pago com motivo).
 * O motoboy não confirma Pix nem muda valor: quem decide é o servidor.
 *
 * Sem internet: a ação fica numa fila local e é reenviada ao reconectar, com a MESMA chave (o
 * servidor ignora repetição — nada se duplica).
 */
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const brlC = (c: number) => brl(c / 100)
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
const enderecoCompleto = enderecoCompletoPedido

type PedidoApp = Pedido & { saiuParaEntregaEm?: string | null }
interface PortalData {
  entregador: { nome: string; restauranteNome: string }
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
  const enviando = useRef(false)

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

  const pedidosServidor = data?.pedidos ?? []
  const naFila = new Set(fila.map((f) => f.pedidoId))
  const pedidos = pedidosServidor.filter((p) => !naFila.has(p.id) || fila.some((f) => f.pedidoId === p.id && f.url.endsWith('/saiu')))
  const disponiveis = data?.disponiveis ?? []
  const despachoAberto = data?.despachoAberto ?? false
  const fin = data?.financeiro
  const routeStops = useMemo(() => pedidos.map((p, i) => ({ id: p.id, numero: i + 1, address: enderecoCompleto(p) })), [pedidos])

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

  async function pegarPedido(pedidoId: string) {
    setBusy(pedidoId); setActionError(null)
    try {
      const res = await fetch(`${apiBase}/pedidos/${pedidoId}/pegar`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Não foi possível pegar o pedido')
      await refetch()
    } catch (err) { setActionError(err instanceof Error ? err.message : 'Não foi possível pegar o pedido') } finally { setBusy(null) }
  }

  if (loading) return <div className="flex min-h-dvh items-center justify-center bg-page text-sm text-text-subtle">Carregando sua rota…</div>
  if (error || !data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-page p-6">
        <div className="w-full max-w-sm rounded-menuzia border border-border bg-white p-5 text-center" data-testid="motoboy-erro">
          <h1 className="text-sm font-semibold text-danger">{error?.login ? 'Entre com o seu login' : apiBase === '/api/motoboy' ? 'Acesso não liberado' : 'Link inválido'}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-text-subtle">{error?.texto ?? 'Não encontramos sua rota.'}</p>
          {error?.login && <a href="/login" className="mt-3 inline-block rounded-menuzia bg-primary px-4 py-2 text-[12px] font-semibold uppercase text-white">Entrar</a>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-page pb-10" data-testid="motoboy-app">
      <header className="bg-sidebar-bg px-4 py-4 text-white">
        <div className="mx-auto max-w-[480px]">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sidebar-text">{data.entregador.restauranteNome}</div>
          <h1 className="text-lg font-semibold">Olá, {data.entregador.nome}</h1>
          <div className="mt-3 flex gap-2">
            <div className="flex-1 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Em rota</div>
              <div className="text-xl font-semibold">{pedidos.length}</div>
            </div>
            <div className="flex-1 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Entregues hoje</div>
              <div className="text-xl font-semibold">{data.concluidosHoje}</div>
            </div>
            {fin?.ativo && (
              <div className="flex-1 rounded-menuzia bg-white/10 px-3 py-2" data-testid="motoboy-comigo">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Dinheiro comigo</div>
                <div className="text-xl font-semibold text-status-ready">{brlC(fin.comigoCentavos)}</div>
              </div>
            )}
          </div>
          {!fin?.ativo && data.caixaHoje.recebido > 0 && (
            <div className="mt-2 rounded-menuzia bg-white/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-text">Caixa em dinheiro hoje</div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[10px] text-sidebar-text">Recebido</div><div className="text-sm font-semibold">{brl(data.caixaHoje.recebido)}</div></div>
                <div><div className="text-[10px] text-sidebar-text">Troco dado</div><div className="text-sm font-semibold">{brl(data.caixaHoje.trocoDado)}</div></div>
                <div><div className="text-[10px] text-sidebar-text">Devolver</div><div className="text-sm font-semibold text-status-ready">{brl(data.caixaHoje.aDevolver)}</div></div>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[480px] px-4 pt-4">
        {(!online || fila.length > 0) && (
          <div className="mb-3 flex items-start gap-2 rounded-menuzia border border-warn/50 bg-warn-bg px-3.5 py-2.5 text-[13px] font-medium text-[#92400E]" data-testid="motoboy-offline">
            <WifiOff className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{!online ? 'Sem internet.' : 'Enviando…'} {fila.length > 0 && `${fila.length} ação(ões) guardada(s) — enviamos assim que a conexão voltar.`}</span>
          </div>
        )}
        {actionError && <div className="mb-3 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger" data-testid="motoboy-erro-acao">{actionError}</div>}

        {routeStops.length > 0 && (
          <div className="mb-4 overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Sua rota — paradas na ordem da lista abaixo</div>
            <RouteMap apiKey={MAPS_KEY} origin={geo} stops={routeStops} loja={data.loja} className="h-[220px] w-full" />
            {!geo && (
              <button onClick={atualizarLocalizacao} className="flex w-full items-center justify-center gap-1.5 border-t border-border bg-white py-2 text-xs font-semibold text-primary hover:bg-page">
                Ativar localização para ver a rota a partir de você
              </button>
            )}
          </div>
        )}

        {pedidos.length > 0 && (
          <div className="flex flex-col gap-3">
            {pedidos.map((order, index) => {
              const liberado = index === 0
              const levar = order.formaPagamento === 'dinheiro' && !order.pago ? trocoLevar(order.total, order.trocoPara) : 0
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
                    <div className="mt-1 flex gap-3">
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(enderecoCompleto(order))}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary">Google Maps →</a>
                      <a href={`https://waze.com/ul?q=${encodeURIComponent(enderecoCompleto(order))}&navigate=yes`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary">Waze →</a>
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
                          className="flex items-center justify-center gap-1.5 rounded-menuzia border border-primary py-2.5 text-xs font-semibold uppercase tracking-wide text-primary disabled:opacity-50">
                          <Navigation className="h-4 w-4" /> Saí para entrega
                        </button>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => setNaoEntreguei(order.id)} disabled={busy === order.id} data-testid="motoboy-nao-entreguei"
                          className="rounded-menuzia border border-danger px-3 py-3 text-xs font-semibold uppercase tracking-wide text-danger hover:bg-danger-bg disabled:opacity-50">
                          Não consegui
                        </button>
                        <button onClick={() => (fin?.ativo ? setPagando(order.id) : void enviar(order, 'entregar', {}, 'entregue'))} disabled={busy === order.id} data-testid="motoboy-entregue"
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-menuzia bg-status-ready py-3 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:brightness-95 disabled:opacity-50">
                          <Check className="h-4 w-4" /> {busy === order.id ? 'Enviando…' : 'Entregue'}
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
                      className="flex w-full items-center justify-center gap-1.5 rounded-menuzia bg-status-pending py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-40">
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

        {fin?.ativo && fin.historico.length > 0 && (
          <div className="mt-5 rounded-menuzia border border-border bg-white" data-testid="motoboy-historico">
            <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Hoje</div>
            <ul className="divide-y divide-border text-[13px]">
              {fin.historico.map((h, i) => (
                <li key={i} className="flex justify-between px-3 py-2">
                  <span>#{h.numero} · {ROTULO_HIST[h.forma] ?? h.forma}{h.trocoDadoCentavos ? ` · troco ${brlC(h.trocoDadoCentavos)}` : ''}</span>
                  <span className="font-semibold">{brlC(h.totalCentavos)}</span>
                </li>
              ))}
            </ul>
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
