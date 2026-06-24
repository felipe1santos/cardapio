'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'

export interface HeatPoint {
  /** Bairro a geocodificar. */
  bairro: string
  /** Peso do ponto = nº de pedidos no bairro (quanto maior, mais quente). */
  weight: number
}

interface HeatmapCardProps {
  apiKey?: string
  /** Endereço/CEP da loja — centraliza e enviesa a geocodificação dos bairros na região certa. */
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

// Mapa de calor em escala de vermelho: mais pedidos = mais quente/vermelho
const HEAT_GRADIENT = [
  'rgba(255, 235, 59, 0)',
  'rgba(255, 193, 7, 0.6)',
  'rgba(255, 152, 0, 0.75)',
  'rgba(249, 115, 22, 0.85)',
  'rgba(239, 68, 68, 0.95)',
  'rgba(185, 28, 28, 1)',
]

const DEFAULT_CENTER = { lat: -14.235, lng: -51.925 } // Brasil (fallback)

/** Mapa de calor (hotspots) dos bairros que mais pedem, centrado/enviesado na região da loja. */
export function HeatmapCard({ apiKey, center, points, className }: HeatmapCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  // tipos de @types/google.maps p/ visualization variam por versão — usamos any no layer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const heatRef = useRef<any>(null)
  const circlesRef = useRef<google.maps.Circle[]>([])
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

  // 2) Centra na loja (geocode do CEP/endereço) e calcula a caixa de bias para os bairros
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    let cancelled = false
    const aplicarBias = (pos: google.maps.LatLng) => {
      map.setCenter(pos)
      map.setZoom(13)
      const d = 0.12 // ~13km de raio para enviesar a busca dos bairros
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

  // Limpa overlays anteriores (heat + círculos fallback)
  const limparOverlays = useCallback(() => {
    heatRef.current?.setMap(null)
    heatRef.current = null
    circlesRef.current.forEach((c) => c.setMap(null))
    circlesRef.current = []
  }, [])

  // Desenha hotspots. Usa HeatmapLayer; se a lib visualization faltar, cai p/ círculos vermelhos.
  const desenhar = useCallback(
    (map: google.maps.Map, data: { location: google.maps.LatLng; weight: number }[], bounds: google.maps.LatLngBounds) => {
      limparOverlays()
      if (data.length === 0) return
      const maxW = Math.max(...data.map((d) => d.weight)) || 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const HeatmapLayer = (google.maps.visualization as any)?.HeatmapLayer
      if (HeatmapLayer) {
        heatRef.current = new HeatmapLayer({
          map,
          data,
          radius: 48,
          opacity: 0.9,
          gradient: HEAT_GRADIENT,
          dissipating: true,
          maxIntensity: maxW,
        })
      } else {
        // Fallback: círculos vermelhos, mais quentes/opacos quanto mais pedidos
        data.forEach((d) => {
          const t = d.weight / maxW
          circlesRef.current.push(
            new google.maps.Circle({
              map,
              center: d.location,
              radius: 500 + t * 1300, // metros
              strokeColor: '#B91C1C',
              strokeOpacity: 0.5,
              strokeWeight: 1,
              fillColor: '#EF4444',
              fillOpacity: 0.2 + t * 0.45,
            })
          )
        })
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, 56)
    },
    [limparOverlays]
  )

  // 3) Geocodifica os bairros (enviesados pela loja) e desenha o mapa de calor
  const renderizar = useCallback(() => {
    const map = mapRef.current
    if (!ready || !centerResolved || !map) return
    const geocoder = new google.maps.Geocoder()
    const bounds = new google.maps.LatLngBounds()
    const data: { location: google.maps.LatLng; weight: number }[] = []
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
      const chave = `bairro:${pt.bairro.toLowerCase()}`
      const cached = geocodeCache.current.get(chave)
      if (cached) {
        bounds.extend(cached)
        data.push({ location: cached, weight: pt.weight })
        return
      }
      pending++
      const req: google.maps.GeocoderRequest = { address: pt.bairro, region: 'BR' }
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
