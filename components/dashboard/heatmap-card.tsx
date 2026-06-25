'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'

export interface HeatPoint {
  /** Endereço (rua, número, bairro) a geocodificar — um ponto por local de entrega. */
  address: string
  /** Peso do ponto = nº de pedidos naquele endereço (quanto maior, mais quente). */
  weight: number
}

interface HeatmapCardProps {
  apiKey?: string
  /** Endereço/CEP da loja — centraliza e enviesa a geocodificação dos endereços na região certa. */
  center?: string
  points: HeatPoint[]
  className?: string
}

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

const DEFAULT_CENTER = { lat: -14.235, lng: -51.925 } // Brasil (fallback)

interface HotPoint {
  location: google.maps.LatLng
  weight: number
}

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t)

/**
 * Cor do hotspot ao longo do espectro amarelo → laranja → vermelho conforme o volume.
 * t=0 (poucos pedidos) = amarelo; t=1 (muitos) = vermelho.
 */
function heatColor(t: number): { r: number; g: number; b: number } {
  if (t < 0.5) {
    const k = t / 0.5 // amarelo → laranja
    return { r: lerp(250, 249, k), g: lerp(204, 115, k), b: lerp(21, 22, k) }
  }
  const k = (t - 0.5) / 0.5 // laranja → vermelho
  return { r: lerp(249, 220, k), g: lerp(115, 38, k), b: lerp(22, 38, k) }
}

// Nº de pedidos no endereço mais quente a partir do qual a escala alcança o vermelho pleno.
// Abaixo disso a paleta fica travada em amarelo/laranja — vermelho só com concentração real.
const PEDIDOS_PARA_VERMELHO = 14

/**
 * Estilo de um hotspot a partir do nº de pedidos no endereço (`weight`) e do máximo do
 * período (`maxW`). Auto-ajusta com o filtro (dia/semana/mês…), pois `maxW` muda junto.
 *
 * Duas escalas independentes:
 *  - TAMANHO + OPACIDADE: posição relativa no período (`rel`) — endereço mais pedido = maior
 *    e mais sólido; pedido isolado = bolinha pequena e fraca.
 *  - COR (amarelo→laranja→vermelho): `rel` limitado por uma trava absoluta (`reach`), de modo
 *    que poucos pedidos no total permaneçam amarelos e o vermelho só surja quando algum
 *    endereço acumula muitos pedidos.
 */
function hotspotStyle(weight: number, maxW: number) {
  const rel = maxW <= 1 ? 0 : (weight - 1) / (maxW - 1) // 0 = menos pedido do período, 1 = o mais pedido
  const reach = Math.min(1, Math.max(0, (maxW - 1) / (PEDIDOS_PARA_VERMELHO - 1))) // teto da paleta no período
  const colorT = Math.pow(rel, 1.2) * reach // gamma 1.2 alarga a faixa amarela

  const { r, g, b } = heatColor(colorT)
  const diameter = Math.round(22 + Math.sqrt(rel) * 76) // 22..98 px
  const coreA = 0.26 + rel * 0.44 // 0.26..0.70 — translúcido p/ não tampar o mapa atrás
  const midA = coreA * 0.45
  const background =
    `radial-gradient(circle, rgba(${r},${g},${b},${coreA.toFixed(3)}) 0%, ` +
    `rgba(${r},${g},${b},${midA.toFixed(3)}) 42%, rgba(${r},${g},${b},0) 72%)`
  return { diameter, background }
}

const PULSE_STYLE_ID = 'menuzia-hotspot-pulse'

/** Injeta uma única vez a animação de pulsação lenta dos hotspots. */
function ensurePulseKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(PULSE_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PULSE_STYLE_ID
  style.textContent =
    '@keyframes menuziaHotspotPulse{0%,100%{transform:scale(0.82);opacity:.55}50%{transform:scale(1.06);opacity:1}}'
  document.head.appendChild(style)
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
    private dots: { el: HTMLDivElement; location: google.maps.LatLng; diameter: number }[] = []

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

      this.data.forEach((d, i) => {
        const { diameter, background } = hotspotStyle(d.weight, this.maxW)
        const el = document.createElement('div')
        el.style.position = 'absolute'
        el.style.width = `${diameter}px`
        el.style.height = `${diameter}px`
        el.style.borderRadius = '50%'
        el.style.background = background
        el.style.willChange = 'transform, opacity'
        el.style.animation = `menuziaHotspotPulse ${(3.4 + (i % 5) * 0.35).toFixed(2)}s ease-in-out infinite`
        el.style.animationDelay = `${((i % 7) * 0.3).toFixed(2)}s`
        container.appendChild(el)
        this.dots.push({ el, location: d.location, diameter })
      })

      this.container = container
      this.getPanes()!.overlayLayer.appendChild(container)
    }

    draw() {
      const projection = this.getProjection()
      if (!projection) return
      for (const dot of this.dots) {
        const px = projection.fromLatLngToDivPixel(dot.location)
        if (!px) continue
        dot.el.style.left = `${px.x - dot.diameter / 2}px`
        dot.el.style.top = `${px.y - dot.diameter / 2}px`
      }
    }

    onRemove() {
      this.container?.remove()
      this.container = null
      this.dots = []
    }
  }

  HotspotOverlayCtor = HotspotOverlay
  return HotspotOverlayCtor
}

/** Hotspots de pedidos por endereço, com glow translúcido e pulsação lenta, na região da loja. */
export function HeatmapCard({ apiKey, center, points, className }: HeatmapCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const overlayRef = useRef<google.maps.OverlayView | null>(null)
  const geocodeCache = useRef<Map<string, google.maps.LatLng>>(new Map())
  const biasRef = useRef<google.maps.LatLngBounds | null>(null)
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

  // Remove o overlay de hotspots anterior
  const limparOverlays = useCallback(() => {
    overlayRef.current?.setMap(null)
    overlayRef.current = null
  }, [])

  // Desenha os hotspots (um glow pulsante por endereço, raio/cor por volume)
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
        data.push({ location: cached, weight: pt.weight })
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
          data.push({ location: pos, weight: pt.weight })
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
