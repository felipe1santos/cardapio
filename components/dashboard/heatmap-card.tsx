'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'

export interface HeatPoint {
  /** Endereço (rua, número, bairro) a geocodificar — um ponto por local de entrega. */
  address: string
  /** Peso do ponto = nº de pedidos naquele endereço (quanto maior, mais quente). */
  weight: number
  /** Nome da rua — usado como legenda do ponto individual. */
  rua?: string
  /** Bairro — usado como legenda quando vários pontos se juntam numa região. */
  bairro?: string
}

interface HeatmapCardProps {
  apiKey?: string
  /** Endereço/CEP da loja — centraliza e enviesa a geocodificação dos endereços na região certa. */
  center?: string
  points: HeatPoint[]
  className?: string
}

type Tema = 'claro' | 'escuro'

const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f5f6f8' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#d1d5db' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'road.arterial', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbeafe' }] },
]

// Tema escuro (azul-petróleo profundo) — usado só quando o lojista alterna o seletor.
const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5b6b86' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1220' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#243352' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#16233b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0e1830' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#64769a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1c2c49' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1526' }] },
]

const DEFAULT_CENTER = { lat: -14.235, lng: -51.925 } // Brasil (fallback)

interface HotPoint {
  location: google.maps.LatLng
  weight: number
  rua?: string
  bairro?: string
}

/** Cluster de pontos próximos: centroide ponderado + peso somado + membros. */
interface Cluster {
  lat: number
  lng: number
  weight: number
  members: HotPoint[]
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)

// Paleta do mais frio (verde, poucos pedidos) ao mais quente (vermelho, muitos).
const STOPS: { r: number; g: number; b: number }[] = [
  { r: 34, g: 197, b: 94 },   // verde   (#22C55E)
  { r: 132, g: 204, b: 22 },  // verde-lima (#84CC16)
  { r: 250, g: 204, b: 21 },  // amarelo (#FACC15)
  { r: 249, g: 115, b: 22 },  // laranja (#F97316)
  { r: 220, g: 38, b: 38 },   // vermelho (#DC2626)
]

/** Cor do hotspot ao longo do espectro verde → vermelho conforme o volume (t em 0..1). */
function heatColor(t: number): { r: number; g: number; b: number } {
  const clamped = Math.min(1, Math.max(0, t))
  const span = clamped * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(span))
  const k = span - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return { r: lerp(a.r, b.r, k), g: lerp(a.g, b.g, k), b: lerp(a.b, b.b, k) }
}

// Nº de pedidos a partir do qual a escala alcança o vermelho pleno (trava absoluta para
// que poucos pedidos fiquem verdes/amarelos e o vermelho só apareça com concentração real).
const PEDIDOS_PARA_VERMELHO = 14

// Distância (em pixels de tela) abaixo da qual dois pontos se fundem num cluster maior.
// Como é em pixels, ao dar zoom os pontos se afastam e se separam sozinhos; ao afastar,
// se juntam — dando a visão panorâmica da concentração por região.
const RAIO_CLUSTER_PX = 48

const PULSE_STYLE_ID = 'menuzia-hotspot-pulse'

/** Injeta uma única vez a animação de pulsação lenta dos anéis. */
function ensurePulseKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(PULSE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PULSE_STYLE_ID
  style.textContent =
    '@keyframes menuziaHotRing{0%,100%{transform:translate(-50%,-50%) scale(0.85);opacity:.5}50%{transform:translate(-50%,-50%) scale(1.12);opacity:.95}}'
  document.head.appendChild(style)
}

const LABEL_FONT = "ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, Consolas, monospace"

/** Legenda do cluster: rua quando é um ponto só; bairro dominante quando vários se juntam. */
function rotuloCluster(c: Cluster): string {
  if (c.members.length === 1) {
    const m = c.members[0]
    return (m.rua || m.bairro || '').toUpperCase()
  }
  // Vários pontos: usa o bairro mais frequente entre os membros.
  const freq: Record<string, number> = {}
  for (const m of c.members) {
    const b = (m.bairro || m.rua || '').trim()
    if (b) freq[b] = (freq[b] ?? 0) + m.weight
  }
  const dominante = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  return dominante.toUpperCase()
}

/** Agrupa pontos cujos pixels de tela estão a menos de RAIO_CLUSTER_PX uns dos outros. */
function clusterizar(
  pontos: HotPoint[],
  projetar: (loc: google.maps.LatLng) => google.maps.Point | null
): Cluster[] {
  const px = pontos
    .map((p) => ({ p, pt: projetar(p.location) }))
    .filter((x): x is { p: HotPoint; pt: google.maps.Point } => Boolean(x.pt))
  // Pontos mais pesados "semeiam" os clusters primeiro.
  px.sort((a, b) => b.p.weight - a.p.weight)

  const clusters: (Cluster & { _x: number; _y: number })[] = []
  for (const { p, pt } of px) {
    let alvo: (Cluster & { _x: number; _y: number }) | null = null
    for (const c of clusters) {
      const dx = c._x - pt.x
      const dy = c._y - pt.y
      if (dx * dx + dy * dy <= RAIO_CLUSTER_PX * RAIO_CLUSTER_PX) {
        alvo = c
        break
      }
    }
    if (alvo) {
      const w = alvo.weight + p.weight
      // centroide ponderado (lat/lng e pixel) para o ponto fundido
      alvo.lat = (alvo.lat * alvo.weight + p.location.lat() * p.weight) / w
      alvo.lng = (alvo.lng * alvo.weight + p.location.lng() * p.weight) / w
      alvo._x = (alvo._x * alvo.weight + pt.x * p.weight) / w
      alvo._y = (alvo._y * alvo.weight + pt.y * p.weight) / w
      alvo.weight = w
      alvo.members.push(p)
    } else {
      clusters.push({ lat: p.location.lat(), lng: p.location.lng(), weight: p.weight, members: [p], _x: pt.x, _y: pt.y })
    }
  }
  return clusters.map(({ _x, _y, ...c }) => { void _x; void _y; return c })
}

// Mantém a classe do OverlayView entre renders (só pode ser criada depois do Maps carregar).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let HotspotOverlayCtor: any = null

function getHotspotOverlay() {
  if (HotspotOverlayCtor) return HotspotOverlayCtor

  class HotspotOverlay extends google.maps.OverlayView {
    private data: HotPoint[]
    private maxW: number
    private container: HTMLDivElement | null = null
    private nodes: { el: HTMLDivElement; lat: number; lng: number }[] = []
    private lastZoom: number | null = null

    constructor(data: HotPoint[], maxW: number) {
      super()
      this.data = data
      this.maxW = maxW
    }

    onAdd() {
      ensurePulseKeyframes()
      const container = document.createElement('div')
      container.style.position = 'absolute'
      container.style.top = '0'
      container.style.left = '0'
      container.style.pointerEvents = 'none'
      this.container = container
      this.getPanes()!.overlayLayer.appendChild(container)
    }

    /** Constrói o pino do cluster (mesma forma de gota do Despacho de rotas): cor por
     *  volume (verde→vermelho), nº de pedidos no centro, legenda da rua/bairro acima. */
    private criarNo(c: Cluster, refMax: number): HTMLDivElement {
      const colorT = Math.min(1, (c.weight - 1) / (PEDIDOS_PARA_VERMELHO - 1))
      const { r, g, b } = heatColor(colorT)
      const fill = `rgb(${r},${g},${b})`
      const rel = refMax <= 1 ? 0 : Math.min(1, (c.weight - 1) / (refMax - 1))
      const w = Math.round(36 + Math.sqrt(rel) * 16) // 36..52 px de largura
      const h = Math.round((w * 46) / 40)

      const wrap = document.createElement('div')
      wrap.style.position = 'absolute'
      wrap.style.willChange = 'transform'
      // ponta (base) do pino ancorada no ponto geográfico
      wrap.style.transform = 'translate(-50%, -100%)'

      wrap.innerHTML = `
        <svg width="${w}" height="${h}" viewBox="0 0 40 46" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4))">
          <path d="M20 0C9.5 0 1 7.8 1 17.4 1 30.3 20 46 20 46s19-15.7 19-28.6C39 7.8 30.5 0 20 0z" fill="${fill}" stroke="#ffffff" stroke-width="2"/>
          <text x="20" y="23" font-size="13" font-weight="800" text-anchor="middle" fill="#ffffff" font-family="Inter, sans-serif">${c.weight}</text>
        </svg>`

      // legenda (rua/bairro) acima do pino
      const rotulo = rotuloCluster(c)
      if (rotulo) {
        const label = document.createElement('div')
        label.textContent = c.members.length > 1 ? `${rotulo} ·${c.members.length}` : rotulo
        label.style.position = 'absolute'
        label.style.left = '50%'
        label.style.top = '-14px'
        label.style.transform = 'translateX(-50%)'
        label.style.whiteSpace = 'nowrap'
        label.style.font = `700 10px/1 ${LABEL_FONT}`
        label.style.letterSpacing = '0.06em'
        label.style.color = '#111827'
        label.style.textShadow = '0 1px 3px rgba(255,255,255,0.95), 0 0 2px rgba(255,255,255,0.9)'
        wrap.appendChild(label)
      }

      wrap.title = `${c.weight} pedido${c.weight > 1 ? 's' : ''}${c.members.length > 1 ? ` · ${c.members.length} locais` : ''}`
      return wrap
    }

    private reconstruir() {
      if (!this.container) return
      const projection = this.getProjection()
      if (!projection) return
      const clusters = clusterizar(this.data, (loc) => projection.fromLatLngToDivPixel(loc))
      const refMax = Math.max(this.maxW, ...clusters.map((c) => c.weight), 1)

      this.container.innerHTML = ''
      this.nodes = []
      for (const c of clusters) {
        const el = this.criarNo(c, refMax)
        this.container.appendChild(el)
        this.nodes.push({ el, lat: c.lat, lng: c.lng })
      }
    }

    draw() {
      const projection = this.getProjection()
      if (!projection) return
      const map = this.getMap() as google.maps.Map | null
      const zoom = map?.getZoom() ?? null
      // Reclusteriza só quando o zoom muda (no pan as distâncias relativas não mudam).
      if (zoom !== this.lastZoom) {
        this.lastZoom = zoom
        this.reconstruir()
      }
      for (const n of this.nodes) {
        const px = projection.fromLatLngToDivPixel(new google.maps.LatLng(n.lat, n.lng))
        if (!px) continue
        n.el.style.left = `${px.x}px`
        n.el.style.top = `${px.y}px`
      }
    }

    onRemove() {
      this.container?.remove()
      this.container = null
      this.nodes = []
      this.lastZoom = null
    }
  }

  HotspotOverlayCtor = HotspotOverlay
  return HotspotOverlayCtor
}

/** Hotspots de pedidos por endereço, com clustering por proximidade, na região da loja. */
export function HeatmapCard({ apiKey, center, points, className }: HeatmapCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlayRef = useRef<google.maps.OverlayView | null>(null)
  const geocodeCache = useRef<Map<string, google.maps.LatLng>>(new Map())
  const biasRef = useRef<google.maps.LatLngBounds | null>(null)
  const pointMetaRef = useRef<Map<string, { rua?: string; bairro?: string }>>(new Map())
  const [ready, setReady] = useState(false)
  const [centerResolved, setCenterResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState(false)
  const [aplicado, setAplicado] = useState(false)
  const [tema, setTema] = useState<Tema>('claro')

  // 1) Carrega o mapa
  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 4,
          styles: LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy', // zoom/pan livre sem segurar Ctrl
        })
        setReady(true)
      })
      .catch(() => setError('Não foi possível carregar o mapa.'))
    return () => {
      cancelled = true
    }
  }, [apiKey])

  // Alterna o estilo do mapa (claro/escuro) sem recriar o mapa nem mexer nos pontos.
  useEffect(() => {
    if (!ready || !mapRef.current) return
    mapRef.current.setOptions({ styles: tema === 'escuro' ? DARK_MAP_STYLE : LIGHT_MAP_STYLE })
  }, [tema, ready])

  // 2) Centra na loja (geocode do CEP/endereço) e calcula a caixa de bias para os endereços
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    let cancelled = false
    const aplicarBias = (pos: google.maps.LatLng) => {
      map.setCenter(pos)
      map.setZoom(13)
      const d = 0.12 // ~13km de raio para enviesar a busca dos endereços
      biasRef.current = new google.maps.LatLngBounds(
        new google.maps.LatLng(pos.lat() - d, pos.lng() - d),
        new google.maps.LatLng(pos.lat() + d, pos.lng() + d)
      )
      if (!cancelled) setCenterResolved(true)
    }
    if (!center?.trim()) {
      biasRef.current = null
      setCenterResolved(true)
      return
    }
    const geocoder = new google.maps.Geocoder()
    geocoder.geocode({ address: center, region: 'BR' }, (results, status) => {
      if (cancelled) return
      if (status === google.maps.GeocoderStatus.OK && results?.[0]) aplicarBias(results[0].geometry.location)
      else setCenterResolved(true)
    })
    return () => {
      cancelled = true
    }
  }, [ready, center])

  // Guarda rua/bairro por endereço, para o overlay rotular os pontos/clusters.
  useEffect(() => {
    const m = new Map<string, { rua?: string; bairro?: string }>()
    for (const p of points) m.set(p.address.toLowerCase(), { rua: p.rua, bairro: p.bairro })
    pointMetaRef.current = m
  }, [points])

  // Remove o overlay de hotspots anterior
  const limparOverlays = useCallback(() => {
    overlayRef.current?.setMap(null)
    overlayRef.current = null
  }, [])

  // Desenha os hotspots (clusters por endereço, raio/cor por volume)
  const desenhar = useCallback(
    (map: google.maps.Map, data: HotPoint[], bounds: google.maps.LatLngBounds) => {
      limparOverlays()
      if (data.length === 0) return
      const maxW = Math.max(...data.map((d) => d.weight)) || 1
      const Overlay = getHotspotOverlay()
      const overlay = new Overlay(data, maxW)
      overlay.setMap(map)
      overlayRef.current = overlay
      if (!bounds.isEmpty()) map.fitBounds(bounds, 56)
    },
    [limparOverlays]
  )

  // 3) Geocodifica os endereços (enviesados pela loja) e desenha os hotspots
  const renderizar = useCallback(() => {
    const map = mapRef.current
    if (!ready || !centerResolved || !map) return
    const geocoder = new google.maps.Geocoder()
    const bounds = new google.maps.LatLngBounds()
    const data: HotPoint[] = []
    let pending = 0
    let resolved = 0
    setResolvendo(true)

    const meta = (addr: string) => pointMetaRef.current.get(addr.toLowerCase()) ?? {}

    const finalizar = () => {
      if (resolved === pending) {
        setResolvendo(false)
        setAplicado(true)
        desenhar(map, data, bounds)
      }
    }

    points.forEach((pt) => {
      const chave = `addr:${pt.address.toLowerCase()}`
      const cached = geocodeCache.current.get(chave)
      if (cached) {
        bounds.extend(cached)
        data.push({ location: cached, weight: pt.weight, ...meta(pt.address) })
        return
      }
      pending++
      const req: google.maps.GeocoderRequest = { address: pt.address, region: 'BR' }
      if (biasRef.current) req.bounds = biasRef.current
      geocoder.geocode(req, (results, status) => {
        resolved++
        if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
          const pos = results[0].geometry.location
          geocodeCache.current.set(chave, pos)
          bounds.extend(pos)
          data.push({ location: pos, weight: pt.weight, ...meta(pt.address) })
        }
        finalizar()
      })
    })

    if (pending === 0) {
      setResolvendo(false)
      setAplicado(true)
      desenhar(map, data, bounds)
    }
  }, [ready, centerResolved, points, desenhar])

  // Auto-aplica uma vez quando o mapa estiver pronto e houver pedidos
  useEffect(() => {
    if (ready && centerResolved && !aplicado && points.length > 0) renderizar()
  }, [ready, centerResolved, aplicado, points.length, renderizar])

  // Se os pedidos do período mudarem, exige reaplicar
  useEffect(() => {
    setAplicado(false)
  }, [points])

  if (!apiKey) {
    return (
      <div className={`flex items-center justify-center rounded-menuzia border border-dashed border-border bg-page p-8 text-center text-sm text-text-subtle ${className ?? ''}`}>
        Mapa indisponível — configure a chave do Google Maps.
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-menuzia ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />

      <button
        type="button"
        onClick={renderizar}
        disabled={resolvendo || points.length === 0}
        className="absolute left-2 top-2 rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {resolvendo ? 'Calculando…' : aplicado ? 'Reaplicar mapa' : 'Aplicar mapa'}
      </button>

      {/* Seletor de tema do mapa (claro/escuro) */}
      <div className="absolute right-2 top-2 inline-flex overflow-hidden rounded-menuzia border border-border bg-white/95 shadow backdrop-blur-sm">
        {(['claro', 'escuro'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTema(t)}
            className={`px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
              tema === t ? 'bg-text-main text-white' : 'text-text-subtle hover:bg-page'
            }`}
          >
            {t === 'claro' ? 'Claro' : 'Escuro'}
          </button>
        ))}
      </div>

      {!resolvendo && points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-page/70 px-6 text-center text-xs text-text-subtle">
          {center?.trim()
            ? 'Sem pedidos com endereço neste período.'
            : 'Conclua o cadastro e informe o CEP da loja em Ajustes para visualizar os dados de pedidos por região.'}
        </div>
      )}
      {error && (
        <div className="absolute inset-x-2 bottom-2 rounded-menuzia bg-white/95 px-3 py-1.5 text-center text-[11px] font-medium text-danger shadow">
          {error}
        </div>
      )}
    </div>
  )
}
