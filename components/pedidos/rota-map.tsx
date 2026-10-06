'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'

export interface RotaMapStop {
  id: string
  label: string
  address: string
  color: string
  clickable: boolean
}

export interface RotaMapDriver {
  id: string
  lat: number
  lng: number
  nome: string
}

/** Onde a loja fica: o mapa abre nela e o enquadramento a inclui. */
export interface RotaMapLoja {
  lat: number | null
  lng: number | null
  /** "Cidade, UF": usado quando a loja não tem coordenadas, e para puxar a geocodificação para perto. */
  cidade: string | null
}

interface RotaMapProps {
  apiKey?: string
  stops: RotaMapStop[]
  drivers: RotaMapDriver[]
  onStopClick: (id: string) => void
  className?: string
  /** 'carregando' = ainda buscando a loja: o mapa espera antes de geocodificar (o cache guardaria o endereço sem viés). */
  loja?: RotaMapLoja | null | 'carregando'
}

/**
 * Sem nada da loja, o mapa abria em Fortaleza (centro fixo, herança do protótipo) e ficava lá
 * quando não havia pedido pronto ou o endereço não geocodificava. Agora o centro de reserva é o
 * Brasil inteiro — e só se a loja não tiver coordenadas nem cidade.
 */
const CENTRO_BRASIL = { lat: -14.24, lng: -51.93 }
const ZOOM_BRASIL = 4
const ZOOM_LOJA = 14
/** Meia-largura (graus) da caixa em volta da loja que puxa a geocodificação para a cidade dela. */
const RAIO_VIES = 0.35

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

function pinIcon(label: string, color: string): google.maps.Icon {
  const light = color.toUpperCase() === '#FACC15'
  const text = light ? '#1F2937' : '#ffffff'
  const w = 40
  const h = 46
  const svg = `
    <svg width="${w}" height="${h}" viewBox="0 0 40 46" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 0C9.5 0 1 7.8 1 17.4 1 30.3 20 46 20 46s19-15.7 19-28.6C39 7.8 30.5 0 20 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
      <text x="20" y="23" font-size="11" font-weight="800" text-anchor="middle" fill="${text}" font-family="Inter, sans-serif">${label}</text>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(w / 2, h),
  }
}

function motoIcon(): google.maps.Icon {
  const svg = `
    <svg width="38" height="38" viewBox="0 0 38 38" xmlns="http://www.w3.org/2000/svg">
      <circle cx="19" cy="19" r="16" fill="#0688D4" stroke="#ffffff" stroke-width="3"/>
      <text x="19" y="25" font-size="17" text-anchor="middle">🛵</text>
    </svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(38, 38),
    anchor: new google.maps.Point(19, 19),
  }
}

/** Mapa do despacho: pinos de pedido coloridos por status + motos dos entregadores. */
export function RotaMap({ apiKey, stops, drivers, onStopClick, className, loja }: RotaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const stopMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const driverMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const geocodeCache = useRef<Map<string, google.maps.LatLng>>(new Map())
  const fittedRef = useRef(false)
  const stopsKeyRef = useRef('')
  const clickRef = useRef(onStopClick)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Posição da loja: as coordenadas de Ajustes ou, sem elas, a cidade geocodificada.
  const [posLoja, setPosLoja] = useState<google.maps.LatLng | null>(null)
  const lojaAplicadaRef = useRef(false)
  const lojaKeyRef = useRef('')
  const [lojaPronta, setLojaPronta] = useState(false)

  clickRef.current = onStopClick

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
          // 'greedy' = o scroll do mouse dá zoom direto, sem exigir Ctrl
          // (remove a mensagem "use ctrl + scroll para dar zoom").
          gestureHandling: 'greedy',
          scrollwheel: true,
        })
        setReady(true)
      })
      .catch(() => setError('Não foi possível carregar o mapa.'))
    return () => {
      cancelled = true
    }
  }, [apiKey])

  // Loja: coordenadas de Ajustes; sem elas, a cidade ("Cidade, UF") geocodificada.
  const carregandoLoja = loja === 'carregando'
  const dadosLoja = loja && loja !== 'carregando' ? loja : null
  const lojaLat = dadosLoja?.lat ?? null
  const lojaLng = dadosLoja?.lng ?? null
  const lojaCidade = dadosLoja?.cidade ?? null
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

  // Sem pedido no mapa (ainda), abre na loja.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !posLoja || lojaAplicadaRef.current || fittedRef.current) return
    lojaAplicadaRef.current = true
    map.setCenter(posLoja)
    map.setZoom(ZOOM_LOJA)
  }, [ready, posLoja])

  // Marcadores de pedido (geocodificados, coloridos por status)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !lojaPronta) return
    let cancelled = false
    const geocoder = new google.maps.Geocoder()
    const wanted = new Set(stops.map((s) => s.id))

    // Quando o conjunto de pedidos muda (ex.: chegou um pedido pronto novo),
    // re-centraliza o mapa pra enquadrar todos os pontos atuais.
    const stopsKey = stops.map((s) => s.id).sort().join(',')
    if (stopsKey !== stopsKeyRef.current) {
      stopsKeyRef.current = stopsKey
      fittedRef.current = false
    }
    // A loja chegou (ou mudou) depois do primeiro enquadramento: enquadra de novo, com ela.
    const lojaKey = posLoja ? posLoja.toUrlValue() : ''
    if (lojaKey !== lojaKeyRef.current) {
      lojaKeyRef.current = lojaKey
      fittedRef.current = false
    }

    stopMarkersRef.current.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.setMap(null)
        stopMarkersRef.current.delete(id)
      }
    })

    const bounds = new google.maps.LatLngBounds()
    let pending = 0
    let resolved = 0

    const place = (stop: RotaMapStop, pos: google.maps.LatLng) => {
      bounds.extend(pos)
      const existing = stopMarkersRef.current.get(stop.id)
      if (existing) {
        existing.setIcon(pinIcon(stop.label, stop.color))
        existing.setPosition(pos)
        return
      }
      const marker = new google.maps.Marker({ map, position: pos, icon: pinIcon(stop.label, stop.color), zIndex: 50 })
      if (stop.clickable) marker.addListener('click', () => clickRef.current(stop.id))
      stopMarkersRef.current.set(stop.id, marker)
    }

    const maybeFit = () => {
      if (fittedRef.current || resolved !== pending) return
      if (bounds.isEmpty()) {
        // Nenhum pedido no mapa (ou nenhum endereço achado): fica na loja.
        if (posLoja) { map.setCenter(posLoja); map.setZoom(ZOOM_LOJA) }
        return
      }
      fittedRef.current = true
      // Enquadra a loja junto com os pedidos.
      if (posLoja) bounds.extend(posLoja)
      if (stops.length === 1 && !posLoja) {
        map.setCenter(bounds.getCenter())
        map.setZoom(15)
      } else {
        map.fitBounds(bounds, 64)
      }
    }
    // Endereço sem cidade puxado para perto da loja (rua homônima em outro estado não ganha).
    const vies = posLoja
      ? new google.maps.LatLngBounds(
          { lat: posLoja.lat() - RAIO_VIES, lng: posLoja.lng() - RAIO_VIES },
          { lat: posLoja.lat() + RAIO_VIES, lng: posLoja.lng() + RAIO_VIES },
        )
      : undefined

    stops.forEach((stop) => {
      const cached = geocodeCache.current.get(stop.address)
      if (cached) {
        place(stop, cached)
        return
      }
      pending++
      geocoder.geocode({ address: stop.address, region: 'BR', bounds: vies }, (results, status) => {
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

    if (pending === 0) maybeFit()

    return () => {
      cancelled = true
    }
  }, [ready, stops, posLoja, lojaPronta])

  // Marcadores das motos (posição direta, sem geocode)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const wanted = new Set(drivers.map((d) => d.id))

    driverMarkersRef.current.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.setMap(null)
        driverMarkersRef.current.delete(id)
      }
    })

    drivers.forEach((d) => {
      const pos = { lat: d.lat, lng: d.lng }
      const existing = driverMarkersRef.current.get(d.id)
      if (existing) {
        existing.setPosition(pos)
        return
      }
      const marker = new google.maps.Marker({ map, position: pos, icon: motoIcon(), title: d.nome, zIndex: 80 })
      driverMarkersRef.current.set(d.id, marker)
    })
  }, [ready, drivers])

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
