'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'

export interface RotaMapStop {
  id: string
  label: string
  address: string
  active: boolean
}

interface RotaMapProps {
  apiKey?: string
  stops: RotaMapStop[]
  onStopClick: (id: string) => void
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

function pinIcon(label: string, active: boolean): google.maps.Icon {
  const fill = active ? '#FACC15' : '#0688D4'
  const text = active ? '#1F2937' : '#ffffff'
  const w = 58
  const h = 66
  const svg = `
    <svg width="${w}" height="${h}" viewBox="0 0 58 66" xmlns="http://www.w3.org/2000/svg">
      <path d="M29 0C14.6 0 3 11.2 3 25c0 18.5 26 41 26 41s26-22.5 26-41C55 11.2 43.4 0 29 0z" fill="${fill}" stroke="#ffffff" stroke-width="3"/>
      <text x="29" y="33" font-size="16" font-weight="800" text-anchor="middle" fill="${text}" font-family="Inter, sans-serif">${label}</text>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(w / 2, h),
  }
}

/** Mapa do despacho: pinos clicáveis com o número do pedido. Sem traçar rota. */
export function RotaMap({ apiKey, stops, onStopClick, className }: RotaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const geocodeCache = useRef<Map<string, google.maps.LatLng>>(new Map())
  const clickRef = useRef(onStopClick)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  clickRef.current = onStopClick

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: -3.73, lng: -38.53 },
          zoom: 13,
          styles: LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
        })
        setReady(true)
      })
      .catch(() => setError('Não foi possível carregar o mapa.'))
    return () => {
      cancelled = true
    }
  }, [apiKey])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    let cancelled = false
    const geocoder = new google.maps.Geocoder()
    const wanted = new Set(stops.map((s) => s.id))

    // remove marcadores de pedidos que saíram
    markersRef.current.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.setMap(null)
        markersRef.current.delete(id)
      }
    })

    const bounds = new google.maps.LatLngBounds()
    let pending = 0
    let resolved = 0

    const place = (stop: RotaMapStop, pos: google.maps.LatLng) => {
      bounds.extend(pos)
      const existing = markersRef.current.get(stop.id)
      if (existing) {
        existing.setIcon(pinIcon(stop.label, stop.active))
        existing.setZIndex(stop.active ? 100 : 50)
        existing.setPosition(pos)
        return
      }
      const marker = new google.maps.Marker({
        map,
        position: pos,
        icon: pinIcon(stop.label, stop.active),
        zIndex: stop.active ? 100 : 50,
      })
      marker.addListener('click', () => clickRef.current(stop.id))
      markersRef.current.set(stop.id, marker)
    }

    const maybeFit = () => {
      if (resolved === pending && !bounds.isEmpty()) {
        if (stops.length === 1) {
          map.setCenter(bounds.getCenter())
          map.setZoom(15)
        } else {
          map.fitBounds(bounds, 64)
        }
      }
    }

    stops.forEach((stop) => {
      const cached = geocodeCache.current.get(stop.address)
      if (cached) {
        place(stop, cached)
        return
      }
      pending++
      geocoder.geocode({ address: stop.address, region: 'BR' }, (results, status) => {
        if (cancelled) return
        resolved++
        if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
          const pos = results[0].geometry.location
          geocodeCache.current.set(stop.address, pos)
          place(stop, pos)
        }
        maybeFit()
      })
    })

    // se tudo veio do cache, ajusta na hora
    if (pending === 0 && !bounds.isEmpty()) {
      if (stops.length === 1) {
        map.setCenter(bounds.getCenter())
        map.setZoom(15)
      } else {
        map.fitBounds(bounds, 64)
      }
    }

    return () => {
      cancelled = true
    }
  }, [ready, stops])

  if (!apiKey) {
    return (
      <div className={`flex items-center justify-center border border-dashed border-border bg-page p-8 text-center text-sm text-text-subtle ${className ?? ''}`}>
        Mapa indisponível — configure a chave do Google Maps.
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-x-2 bottom-2 rounded-menuzia bg-white/95 px-3 py-1.5 text-center text-[11px] font-medium text-danger shadow">
          {error}
        </div>
      )}
    </div>
  )
}
