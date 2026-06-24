'use client'

import { useEffect, useRef, useState } from 'react'
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
  'rgba(255, 193, 7, 0.55)',
  'rgba(255, 152, 0, 0.7)',
  'rgba(249, 115, 22, 0.82)',
  'rgba(239, 68, 68, 0.92)',
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
  const geocodeCache = useRef<Map<string, google.maps.LatLng>>(new Map())
  const biasRef = useRef<google.maps.LatLngBounds | null>(null)
  const [ready, setReady] = useState(false)
  const [centerResolved, setCenterResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState(false)

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
          gestureHandling: 'cooperative',
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

  // 3) Geocodifica os bairros (enviesados pela loja) e desenha o mapa de calor
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !centerResolved || !map) return
    let cancelled = false
    const geocoder = new google.maps.Geocoder()
    const bounds = new google.maps.LatLngBounds()
    const data: { location: google.maps.LatLng; weight: number }[] = []
    let pending = 0
    let resolved = 0
    setResolvendo(true)

    const aplicar = () => {
      if (cancelled) return
      heatRef.current?.setMap(null)
      if (data.length === 0) {
        heatRef.current = null
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const HeatmapLayer = (google.maps.visualization as any).HeatmapLayer
      heatRef.current = new HeatmapLayer({
        map,
        data,
        radius: 44,
        opacity: 0.85,
        gradient: HEAT_GRADIENT,
        dissipating: true,
      })
      if (!bounds.isEmpty()) map.fitBounds(bounds, 56)
    }

    const finalizar = () => {
      if (resolved === pending) {
        setResolvendo(false)
        aplicar()
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
        if (cancelled) return
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
      aplicar()
    }

    return () => {
      cancelled = true
    }
  }, [ready, centerResolved, points])

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
        <div className="absolute right-2 top-2 rounded-menuzia bg-white/95 px-2.5 py-1 text-[11px] font-medium text-text-subtle shadow">
          Calculando hotspots…
        </div>
      )}
      {!resolvendo && points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-page/70 text-center text-xs text-text-subtle">
          Sem pedidos com endereço neste período.
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
