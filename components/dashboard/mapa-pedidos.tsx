'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'
import { CORES_GRAFICO } from '@/components/graficos/grafico'
import { agruparProximos, areaDoBairro, nucleoDoBairro, pertoDaLoja, type PontoLatLng } from '@/lib/mapa-bairros'

/**
 * Mapa "Onde estão seus pedidos" (item 54, 2026-10-04) no visual do kit do financeiro.
 *
 * - Pinos pequenos e sutis (azul #1877F2 da paleta dos gráficos, borda branca) — um por endereço, um pouco
 *   maiores quando o endereço pediu mais vezes. Tooltip no estilo do kit ao passar o mouse ou tocar (fica até
 *   tocar fora).
 * - Contorno SUTIL dos bairros que mais vendem: não há limite oficial de bairro gratuito para todas as cidades
 *   (Google só com Map ID + estilo por dados; IBGE e OpenStreetMap cobrem parte dos municípios), então a área é
 *   desenhada em volta dos pedidos do bairro (envoltória com folga). Linha fina; preenchimento bem transparente,
 *   mais forte quanto mais o bairro vende.
 * - Mapa em cinzas claros; abre já enquadrando a loja e os pedidos (nunca o Brasil inteiro).
 * - Mesma geocodificação de sempre (Geocoder do Maps JS, com cache por sessão): nenhuma API nova.
 */
export interface PontoMapa { address: string; weight: number; rua?: string; bairro?: string }
export interface BairroMapa { bairro: string; pedidos: number; receita: number }

const ESTILO_CINZA: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#eef0f3' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7d8691' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#b3b9c1' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#dde1e6' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#f8f9fa' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#d3d8de' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d9dee4' }] },
]
const AZUL = CORES_GRAFICO.serie1 // #1877F2
const BAIRROS_CONTORNADOS = 6
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

interface Dica { x: number; y: number; titulo: string; linhas: string[] }

// Classe do OverlayView criada só depois do Maps carregar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PinosCtor: any = null
function classePinos() {
  if (PinosCtor) return PinosCtor
  class Pinos extends google.maps.OverlayView {
    private dados: { pos: google.maps.LatLng; p: PontoMapa }[]
    private max: number
    private aoFocar: (d: { pos: google.maps.LatLng; p: PontoMapa } | null, el?: HTMLElement) => void
    private caixa: HTMLDivElement | null = null
    private nos: { el: HTMLDivElement; pos: google.maps.LatLng }[] = []
    constructor(dados: { pos: google.maps.LatLng; p: PontoMapa }[], aoFocar: (d: { pos: google.maps.LatLng; p: PontoMapa } | null, el?: HTMLElement) => void) {
      super(); this.dados = dados; this.max = Math.max(1, ...dados.map((d) => d.p.weight)); this.aoFocar = aoFocar
    }
    onAdd() {
      const c = document.createElement('div')
      c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0'
      this.caixa = c
      this.getPanes()!.overlayMouseTarget.appendChild(c)
      for (const d of this.dados) {
        const t = Math.round(9 + Math.sqrt(d.p.weight / this.max) * 7) // 9..16 px
        const el = document.createElement('div')
        el.setAttribute('data-pino', '')
        el.setAttribute('role', 'button')
        // Fora da camada de toque do painel (min 44 px em [role=button] no celular): o pino esticava em oval.
        el.setAttribute('data-toque-livre', '')
        el.setAttribute('tabindex', '0')
        el.setAttribute('aria-label', `${d.p.rua ? d.p.rua + ', ' : ''}${d.p.bairro ?? ''} — ${d.p.weight} pedido${d.p.weight > 1 ? 's' : ''}`)
        el.style.cssText = `position:absolute;width:${t}px;height:${t}px;min-width:0;min-height:0;padding:0;box-sizing:border-box;margin:${-t / 2}px 0 0 ${-t / 2}px;border-radius:50%;background:${AZUL};opacity:.88;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(28,43,51,.28);cursor:pointer;transition:transform 150ms ease`
        el.onmouseenter = () => { el.style.transform = 'scale(1.25)'; this.aoFocar(d, el) }
        el.onmouseleave = () => { el.style.transform = ''; this.aoFocar(null) }
        el.onfocus = () => this.aoFocar(d, el)
        el.onblur = () => this.aoFocar(null)
        el.onclick = (e) => { e.stopPropagation(); this.aoFocar(d, el) }
        el.ontouchstart = (e) => { e.stopPropagation() }
        c.appendChild(el)
        this.nos.push({ el, pos: d.pos })
      }
    }
    draw() {
      const proj = this.getProjection(); if (!proj) return
      for (const n of this.nos) { const px = proj.fromLatLngToDivPixel(n.pos); if (px) { n.el.style.left = `${px.x}px`; n.el.style.top = `${px.y}px` } }
    }
    onRemove() { this.caixa?.remove(); this.caixa = null; this.nos = [] }
  }
  PinosCtor = Pinos
  return PinosCtor
}

export function MapaPedidos({ apiKey, centro, pontos, bairros, className = '' }: { apiKey?: string; centro?: string; pontos: PontoMapa[]; bairros: BairroMapa[]; className?: string }) {
  const caixa = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const mapa = useRef<google.maps.Map | null>(null)
  const camadas = useRef<{ pinos: google.maps.OverlayView | null; formas: (google.maps.Polygon | google.maps.Marker)[] }>({ pinos: null, formas: [] })
  const cache = useRef(new Map<string, google.maps.LatLng>())
  const lojaPos = useRef<google.maps.LatLng | null>(null)
  const [pronto, setPronto] = useState(false)
  const [enquadrado, setEnquadrado] = useState(false)
  const [centroOk, setCentroOk] = useState(false)
  const [localizando, setLocalizando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dica, setDica] = useState<Dica | null>(null)
  const [desenho, setDesenho] = useState({ pinos: 0, areas: 0, fora: 0 })

  const posicaoNaArea = useCallback((el: HTMLElement | null, cx?: number, cy?: number) => {
    const a = area.current?.getBoundingClientRect(); if (!a) return { x: 0, y: 0 }
    if (el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - a.left, y: r.top - a.top } }
    return { x: (cx ?? 0) - a.left, y: (cy ?? 0) - a.top }
  }, [])

  // 1) carrega o mapa (invisível até enquadrar — nada de Brasil inteiro piscando)
  useEffect(() => {
    if (!apiKey || !caixa.current) return
    let vivo = true
    loadGoogleMaps(apiKey).then(() => {
      if (!vivo || !caixa.current) return
      mapa.current = new google.maps.Map(caixa.current, { center: { lat: -20.33, lng: -40.29 }, zoom: 13, styles: ESTILO_CINZA, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false })
      mapa.current.addListener('click', () => setDica(null))
      setPronto(true)
    }).catch(() => setErro('Não foi possível carregar o mapa.'))
    return () => { vivo = false }
  }, [apiKey])

  // 2) centra na loja
  useEffect(() => {
    const m = mapa.current
    if (!pronto || !m) return
    if (!centro?.trim()) { setCentroOk(true); return }
    let vivo = true
    new google.maps.Geocoder().geocode({ address: centro, region: 'BR' }, (res, st) => {
      if (!vivo) return
      if (st === google.maps.GeocoderStatus.OK && res?.[0]) { lojaPos.current = res[0].geometry.location; m.setCenter(lojaPos.current); m.setZoom(14) }
      setCentroOk(true)
    })
    return () => { vivo = false }
  }, [pronto, centro])

  // 3) geocodifica os endereços e desenha pinos + áreas dos bairros
  useEffect(() => {
    const m = mapa.current
    if (!pronto || !centroOk || !m) return
    let vivo = true
    camadas.current.pinos?.setMap(null); camadas.current.pinos = null
    for (const f of camadas.current.formas) f.setMap(null)
    camadas.current.formas = []
    setDica(null)
    const bias = lojaPos.current ? new google.maps.LatLngBounds(
      { lat: lojaPos.current.lat() - 0.12, lng: lojaPos.current.lng() - 0.12 }, { lat: lojaPos.current.lat() + 0.12, lng: lojaPos.current.lng() + 0.12 }) : null
    const geocoder = new google.maps.Geocoder()
    const achados: { pos: google.maps.LatLng; p: PontoMapa }[] = []
    let pendentes = 0
    const terminar = () => {
      if (!vivo) return
      setLocalizando(false)
      // Endereço geocodificado longe da loja (homônimo em outra cidade) fica fora: senão o zoom vai ao estado inteiro.
      const loja = lojaPos.current ? { lat: lojaPos.current.lat(), lng: lojaPos.current.lng() } : null
      const perto = pertoDaLoja(achados.map((a) => ({ lat: a.pos.lat(), lng: a.pos.lng(), a })), loja).map((x) => x.a)
      const fora = achados.length - perto.length
      achados.length = 0; achados.push(...perto)
      let areas = 0
      const limites = new google.maps.LatLngBounds()
      for (const a of achados) limites.extend(a.pos)
      // Áreas suaves dos bairros que mais vendem (antes dos pinos, por baixo).
      const ranking = [...bairros].filter((b) => b.bairro.trim()).sort((a, b) => b.pedidos - a.pedidos || b.receita - a.receita).slice(0, BAIRROS_CONTORNADOS)
      const maxPed = Math.max(1, ...ranking.map((b) => b.pedidos))
      for (const b of ranking) {
        const pts: PontoLatLng[] = achados.filter((a) => (a.p.bairro ?? '').trim().toLowerCase() === b.bairro.trim().toLowerCase()).map((a) => ({ lat: a.pos.lat(), lng: a.pos.lng() }))
        if (!pts.length) continue
        const rel = b.pedidos / maxPed
        // Núcleo do bairro (sem o pedido solto longe dos outros); dois pedidos distantes viram duas manchas.
        const nucleo = nucleoDoBairro(pts)
        const formas = agruparProximos(nucleo).map((g) => areaDoBairro(g))
        for (const caminho of formas) {
        const poly = new google.maps.Polygon({
          paths: caminho, map: m, strokeColor: AZUL, strokeOpacity: 0.55, strokeWeight: 1, fillColor: AZUL, fillOpacity: 0.04 + rel * 0.12, clickable: true, zIndex: 1,
        })
        areas++
        const mostrar = (e: google.maps.MapMouseEvent) => {
          const ev = e.domEvent as MouseEvent | undefined
          if (!ev) return
          const pos = posicaoNaArea(null, ev.clientX, ev.clientY)
          setDica({ ...pos, titulo: b.bairro, linhas: [`${b.pedidos} pedido${b.pedidos > 1 ? 's' : ''}`, brl(b.receita)] })
          poly.setOptions({ strokeOpacity: 0.9 })
        }
        poly.addListener('mouseover', mostrar)
        poly.addListener('click', mostrar)
        poly.addListener('mouseout', () => { poly.setOptions({ strokeOpacity: 0.55 }); setDica(null) })
        camadas.current.formas.push(poly)
        }
      }
      if (achados.length) {
        const Pinos = classePinos()
        const ov = new Pinos(achados, (d: { pos: google.maps.LatLng; p: PontoMapa } | null, el?: HTMLElement) => {
          if (!d) { setDica(null); return }
          setDica({ ...posicaoNaArea(el ?? null), titulo: [d.p.rua, d.p.bairro].filter(Boolean).join(' · ') || d.p.address, linhas: [`${d.p.weight} pedido${d.p.weight > 1 ? 's' : ''} neste endereço`] })
        })
        ov.setMap(m)
        camadas.current.pinos = ov
        if (lojaPos.current) limites.extend(lojaPos.current)
        m.fitBounds(limites, 48)
        google.maps.event.addListenerOnce(m, 'idle', () => { if ((m.getZoom() ?? 14) > 16) m.setZoom(16) })
      } else if (lojaPos.current) {
        // Sem pedidos com endereço: fica na loja, com o ponto dela.
        camadas.current.formas.push(new google.maps.Marker({ position: lojaPos.current, map: m, title: 'Sua loja',
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#1C2B33', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 } }))
      }
      setDesenho({ pinos: achados.length, areas, fora })
      setEnquadrado(true)
    }
    if (!pontos.length) { terminar(); return () => { vivo = false } }
    setLocalizando(true)
    for (const pt of pontos) {
      const chave = pt.address.toLowerCase()
      const c = cache.current.get(chave)
      if (c) { achados.push({ pos: c, p: pt }); continue }
      pendentes++
      geocoder.geocode({ address: pt.address, region: 'BR', ...(bias ? { bounds: bias } : {}) }, (res, st) => {
        if (st === google.maps.GeocoderStatus.OK && res?.[0]) { cache.current.set(chave, res[0].geometry.location); achados.push({ pos: res[0].geometry.location, p: pt }) }
        if (--pendentes === 0) terminar()
      })
    }
    if (pendentes === 0) terminar()
    return () => { vivo = false }
  }, [pronto, centroOk, pontos, bairros, posicaoNaArea])

  // Toque fora do mapa fecha a dica.
  useEffect(() => {
    if (!dica) return
    const fora = (e: PointerEvent) => { if (!area.current?.contains(e.target as Node)) setDica(null) }
    window.addEventListener('pointerdown', fora, true)
    return () => window.removeEventListener('pointerdown', fora, true)
  }, [dica])

  if (!apiKey) {
    return <div className={`flex items-center justify-center rounded-[8px] border border-dashed border-[#CBD2D9] bg-[#F5F7F9] p-8 text-center text-[13px] text-[#465A69] ${className}`}>Mapa indisponível — configure a chave do Google Maps.</div>
  }
  return (
    <div ref={area} className={`relative overflow-hidden rounded-[8px] border border-[#CBD2D9] bg-[#f3f4f6] ${className}`} data-testid="mapa-pedidos" data-enquadrado={enquadrado ? 'sim' : 'nao'} data-pinos={desenho.pinos} data-areas={desenho.areas} data-fora={desenho.fora}>
      <div ref={caixa} className={`h-full w-full transition-opacity duration-200 ${enquadrado ? 'opacity-100' : 'opacity-0'}`} />
      {(!enquadrado || localizando) && !erro && (
        <span className="absolute left-3 top-3 rounded-[6px] border border-[#CBD2D9] bg-white px-2.5 py-1 text-[12px] font-medium text-[#465A69] shadow-sm">{localizando ? 'Localizando endereços…' : 'Carregando mapa…'}</span>
      )}
      {enquadrado && pontos.length === 0 && (
        <span className="absolute inset-x-3 bottom-3 rounded-[6px] border border-[#CBD2D9] bg-white/95 px-3 py-2 text-center text-[12.5px] text-[#465A69] shadow-sm" data-testid="mapa-sem-pedidos">
          {centro?.trim() ? 'Sem pedidos com endereço neste período.' : 'Informe o CEP da loja em Ajustes para ver os pedidos por região.'}
        </span>
      )}
      {dica && (
        <div className="pointer-events-none absolute z-[5] min-w-[160px] max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-[8px] bg-white px-3 py-2 text-[13px] shadow-[0_4px_14px_rgba(28,43,51,0.18)]"
          style={{ left: Math.max(90, Math.min(dica.x, (area.current?.clientWidth ?? 400) - 90)), top: Math.max(dica.y, 70), border: `1px solid ${CORES_GRAFICO.bordaTooltip}`, color: CORES_GRAFICO.texto }} data-testid="mapa-dica" role="tooltip">
          <p className="font-bold leading-snug">{dica.titulo}</p>
          {dica.linhas.map((l) => <p key={l} style={{ color: CORES_GRAFICO.eixo }}>{l}</p>)}
        </div>
      )}
      {erro && <div className="absolute inset-x-2 bottom-2 rounded-[6px] bg-white/95 px-3 py-1.5 text-center text-[12px] font-medium text-[#D93616] shadow">{erro}</div>}
    </div>
  )
}
