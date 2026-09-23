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

const LIGHT_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f4f5f7' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a919c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f4f5f7' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#a3a9b3' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e9ebef' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde3ea' }] },
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

// Escala única em laranja (paleta oficial): mais pedidos = bolha maior e mais
// opaca. Um tom só lê melhor que o arco-íris verde→vermelho de antes, que
// sugeria "bom/ruim" onde só existe "pouco/muito".
const COR_BOLHA = '249, 115, 22' // #F97316

// Quantos clusters ganham o nome do bairro escrito: o resto fica só com o
// número, senão os rótulos se atropelam no zoom da cidade inteira.
const ROTULOS_VISIVEIS = 5

const FONTE = "Inter, system-ui, sans-serif"

// Distância (em pixels de tela) abaixo da qual dois pontos se fundem num cluster.
// Em pixels: com zoom os pontos se separam sozinhos; afastando, se juntam.
const RAIO_CLUSTER_PX = 56

/** Legenda do cluster: rua quando é um ponto só; bairro dominante quando vários se juntam. */
function rotuloCluster(c: Cluster): string {
  if (c.members.length === 1) {
    const m = c.members[0]
    return m.bairro || m.rua || ''
  }
  // Vários pontos: usa o bairro mais frequente entre os membros.
  const freq: Record<string, number> = {}
  for (const m of c.members) {
    const b = (m.bairro || m.rua || '').trim()
    if (b) freq[b] = (freq[b] ?? 0) + m.weight
  }
  const dominante = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  return dominante
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
      const container = document.createElement('div')
      container.style.position = 'absolute'
      container.style.top = '0'
      container.style.left = '0'
      container.style.pointerEvents = 'none'
      this.container = container
      this.getPanes()!.overlayLayer.appendChild(container)
    }

    /** Bolha do cluster: halo translúcido + disco com o nº de pedidos; o nome do
     *  bairro vai numa etiqueta branca abaixo, só nos maiores. */
    private criarNo(c: Cluster, refMax: number, comRotulo: boolean): HTMLDivElement {
      const rel = refMax <= 1 ? 1 : Math.min(1, (c.weight - 1) / (refMax - 1))
      const d = Math.round(26 + Math.sqrt(rel) * 22) // 26..48 px
      const halo = Math.round(d * 1.9)
      const opac = (0.55 + rel * 0.45).toFixed(2)

      const wrap = document.createElement('div')
      wrap.style.position = 'absolute'
      wrap.style.transform = 'translate(-50%, -50%)'
      wrap.style.width = `${halo}px`
      wrap.style.height = `${halo}px`
      wrap.style.display = 'flex'
      wrap.style.alignItems = 'center'
      wrap.style.justifyContent = 'center'
      wrap.style.pointerEvents = 'auto'

      wrap.innerHTML = `
        <span style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle, rgba(${COR_BOLHA},0.22) 0%, rgba(${COR_BOLHA},0) 70%)"></span>
        <span style="position:relative;display:flex;align-items:center;justify-content:center;width:${d}px;height:${d}px;border-radius:50%;background:rgba(${COR_BOLHA},${opac});border:2px solid #fff;box-shadow:0 2px 6px rgba(17,24,39,0.18);color:#fff;font:700 ${d > 36 ? 13 : 11}px/1 ${FONTE}">${c.weight}</span>`

      const rotulo = rotuloCluster(c)
      if (comRotulo && rotulo) {
        const label = document.createElement('span')
        label.textContent = rotulo
        label.style.cssText = `position:absolute;top:calc(50% + ${d / 2 + 4}px);left:50%;transform:translateX(-50%);white-space:nowrap;padding:3px 7px;border-radius:4px;background:#fff;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(17,24,39,0.10);font:600 11px/1.2 ${FONTE};color:#1f2937`
        wrap.appendChild(label)
      }

      wrap.title = `${rotulo ? rotulo + ' — ' : ''}${c.weight} pedido${c.weight > 1 ? 's' : ''}`
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
      const destaque = new Set([...clusters].sort((a, b) => b.weight - a.weight).slice(0, ROTULOS_VISIVEIS))
      for (const c of clusters) {
        const el = this.criarNo(c, refMax, destaque.has(c))
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

  // Desenha sozinho quando o mapa fica pronto e sempre que o período muda —
  // o botão "Aplicar mapa" de antes era um passo que ninguém entendia.
  useEffect(() => {
    if (!ready || !centerResolved || aplicado) return
    if (points.length > 0) renderizar()
    else limparOverlays()
  }, [ready, centerResolved, aplicado, points.length, renderizar, limparOverlays])

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

      {resolvendo && (
        <span className="absolute left-2 top-2 rounded-[4px] border border-[var(--adm-borda)] bg-white/95 px-2 py-1 text-[11px] font-medium text-[var(--adm-texto-suave)] shadow-sm">
          Localizando endereços…
        </span>
      )}

      {!resolvendo && points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 px-6 text-center text-[12px] text-[var(--adm-texto-suave)]">
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
