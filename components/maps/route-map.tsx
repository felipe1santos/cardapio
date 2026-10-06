'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'
import { CENTRO_BRASIL, RAIO_VIES, ZOOM_BRASIL, ZOOM_LOJA, type LojaDoMapa } from '@/lib/maps/loja-mapa'
import { LIGHT_MAP_STYLE } from '@/lib/maps/style'

export interface RouteStop {
  id: string
  numero: number
  address: string
}

interface RouteMapProps {
  apiKey?: string
  origin: { lat: number; lng: number } | null
  stops: RouteStop[]
  emptyMessage?: string
  className?: string
  /** Onde a loja fica: o mapa abre nela e volta para ela se a rota não sair (antes: Fortaleza fixo). */
  loja?: LojaDoMapa
}

function motoboyIcon(): google.maps.Icon {
  const svg = `
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="#0688D4" stroke="white" stroke-width="3"/>
      <text x="20" y="27" font-size="18" text-anchor="middle">🛵</text>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 20),
  }
}

function stopPinIcon(numero: number): google.maps.Icon {
  const svg = `
    <svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12.4 17 27 17 27s17-14.6 17-27C34 7.6 26.4 0 17 0z" fill="#A855F7"/>
      <circle cx="17" cy="16" r="11" fill="white"/>
      <text x="17" y="21" font-size="13" font-weight="700" text-anchor="middle" fill="#A855F7" font-family="Inter, sans-serif">${numero}</text>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(34, 44),
    anchor: new google.maps.Point(17, 44),
  }
}

/** Mapa estilizado Menuzia mostrando a posição do entregador e as próximas paradas, na ordem da rota. */
export function RouteMap({ apiKey, origin, stops, emptyMessage, className, loja }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const lastKeyRef = useRef<string>('')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Posição da loja: coordenadas de Ajustes ou, sem elas, a cidade geocodificada.
  const [posLoja, setPosLoja] = useState<google.maps.LatLng | null>(null)
  // A rota só é traçada depois de saber onde a loja fica (ou de saber que não dá para saber):
  // senão o endereço era procurado sem o viés e o mapa pulava para a cidade errada.
  const [lojaPronta, setLojaPronta] = useState(false)
  const carregandoLoja = loja === 'carregando'
  const dadosLoja = loja && loja !== 'carregando' ? loja : null
  const lojaLat = dadosLoja?.lat ?? null
  const lojaLng = dadosLoja?.lng ?? null
  const lojaCidade = dadosLoja?.cidade ?? null

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: CENTRO_BRASIL,
          zoom: ZOOM_BRASIL,
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
    if (!ready || carregandoLoja) return
    if (lojaLat !== null && lojaLng !== null) { setPosLoja(new google.maps.LatLng(lojaLat, lojaLng)); setLojaPronta(true); return }
    if (!lojaCidade) { setLojaPronta(true); return }
    let vivo = true
    new google.maps.Geocoder().geocode({ address: `${lojaCidade}, Brasil`, region: 'BR' }, (r, st) => {
      if (!vivo) return
      if (st === google.maps.GeocoderStatus.OK && r?.[0]) setPosLoja(r[0].geometry.location)
      setLojaPronta(true)
    })
    return () => { vivo = false }
  }, [ready, carregandoLoja, lojaLat, lojaLng, lojaCidade])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !lojaPronta) return
    // Até a rota chegar (ou se ela não sair), o mapa fica na loja — nunca no centro de reserva.
    const naLoja = () => { if (posLoja) { map.setCenter(posLoja); map.setZoom(ZOOM_LOJA) } }

    const key = JSON.stringify({
      loja: posLoja ? posLoja.toUrlValue() : null,
      origin: origin ? [Math.round(origin.lat * 10000), Math.round(origin.lng * 10000)] : null,
      stops: stops.map((s) => s.address),
    })
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []
    directionsRendererRef.current?.setMap(null)
    directionsRendererRef.current = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      preserveViewport: true,
      polylineOptions: {
        strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3, strokeColor: '#0688D4' }, offset: '0', repeat: '12px' }],
      },
    })
    const renderer = directionsRendererRef.current

    if (stops.length === 0) {
      if (origin) {
        markersRef.current.push(new google.maps.Marker({ map, position: origin, icon: motoboyIcon(), zIndex: 50 }))
        map.setCenter(origin)
        map.setZoom(15)
      } else naLoja()
      return
    }
    if (!origin) naLoja()

    const bounds = new google.maps.LatLngBounds()

    if (origin) {
      markersRef.current.push(new google.maps.Marker({ map, position: origin, icon: motoboyIcon(), zIndex: 50 }))
      bounds.extend(origin)
    }

    if (origin || stops.length >= 2) {
      const directionsService = new google.maps.DirectionsService()
      const originPoint = origin ?? stops[0].address
      const destination = stops[stops.length - 1].address
      const middleStops = origin ? stops.slice(0, -1) : stops.slice(1, -1)
      const waypoints = middleStops.map((s) => ({ location: s.address, stopover: true }))

      directionsService.route(
        {
          origin: originPoint,
          destination,
          waypoints,
          optimizeWaypoints: false,
          travelMode: google.maps.TravelMode.DRIVING,
          region: 'BR',
        },
        (result, status) => {
          if (status !== google.maps.DirectionsStatus.OK || !result) {
            setError('Não foi possível calcular a rota — verifique os endereços.')
            if (!origin) naLoja()
            return
          }
          setError(null)
          renderer.setDirections(result)
          const legs = result.routes[0].legs
          const stopPositions = origin
            ? legs.map((leg) => leg.end_location)
            : [legs[0].start_location, ...legs.map((leg) => leg.end_location)]

          stops.forEach((stop, i) => {
            const pos = stopPositions[i]
            if (!pos) return
            markersRef.current.push(new google.maps.Marker({ map, position: pos, icon: stopPinIcon(stop.numero), zIndex: 40 - i }))
            bounds.extend(pos)
          })
          map.fitBounds(bounds, 48)
        }
      )
    } else {
      const geocoder = new google.maps.Geocoder()
      // Endereço puxado para perto da loja (rua homônima em outro estado não ganha).
      const vies = posLoja
        ? new google.maps.LatLngBounds(
            { lat: posLoja.lat() - RAIO_VIES, lng: posLoja.lng() - RAIO_VIES },
            { lat: posLoja.lat() + RAIO_VIES, lng: posLoja.lng() + RAIO_VIES },
          )
        : undefined
      geocoder.geocode({ address: stops[0].address, region: 'BR', bounds: vies }, (results, status) => {
        if (status !== google.maps.GeocoderStatus.OK || !results?.[0]) {
          setError('Não foi possível localizar o endereço da entrega.')
          naLoja()
          return
        }
        setError(null)
        const pos = results[0].geometry.location
        markersRef.current.push(new google.maps.Marker({ map, position: pos, icon: stopPinIcon(stops[0].numero), zIndex: 40 }))
        map.setCenter(pos)
        map.setZoom(15)
      })
    }
  }, [ready, origin, stops, posLoja, lojaPronta])

  if (!apiKey) {
    return (
      <div className={`flex items-center justify-center rounded-menuzia border border-dashed border-border bg-page p-8 text-center text-sm text-text-subtle ${className ?? ''}`}>
        {emptyMessage ?? 'Mapa indisponível — configure a chave do Google Maps.'}
      </div>
    )
  }

  return (
    <div className={`relative overflow-hidden rounded-menuzia ${className ?? ''}`}>
      <div ref={containerRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-x-2 bottom-2 rounded-menuzia bg-white/95 px-3 py-1.5 text-center text-[11px] font-medium text-danger shadow">
          {error}
        </div>
      )}
    </div>
  )
}
