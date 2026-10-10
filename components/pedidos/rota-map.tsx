'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'

export interface RotaMapStop {
  id: string
  label: string
  address: string
  /** Coordenadas gravadas no pedido (servidor, /api/mapa/coordenadas). Sem elas, o pino não aparece. */
  lat: number | null
  lng: number | null
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
  /** "Cidade, UF" (só informativo: o navegador nunca geocodifica — sem coordenadas, o mapa abre no Brasil). */
  cidade: string | null
}

interface RotaMapProps {
  apiKey?: string
  stops: RotaMapStop[]
  drivers: RotaMapDriver[]
  onStopClick: (id: string) => void
  className?: string
  /** 'carregando' = ainda buscando a loja: o mapa espera para enquadrar com ela. */
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

  // Loja: coordenadas de Ajustes. Sem elas, o mapa fica no Brasil (o navegador nunca geocodifica — custo).
  const carregandoLoja = loja === 'carregando'
  const dadosLoja = loja && loja !== 'carregando' ? loja : null
  const lojaLat = dadosLoja?.lat ?? null
  const lojaLng = dadosLoja?.lng ?? null
  useEffect(() => {
    if (!ready || carregandoLoja) return
    if (lojaLat !== null && lojaLng !== null) setPosLoja(new google.maps.LatLng(lojaLat, lojaLng))
    setLojaPronta(true)
  }, [ready, carregandoLoja, lojaLat, lojaLng])

  // Sem pedido no mapa (ainda), abre na loja.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !posLoja || lojaAplicadaRef.current || fittedRef.current) return
    lojaAplicadaRef.current = true
    map.setCenter(posLoja)
    map.setZoom(ZOOM_LOJA)
  }, [ready, posLoja])

  // Marcadores de pedido (coordenadas do servidor, coloridas por status). Nenhuma chamada paga aqui.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !lojaPronta) return
    const comCoord = stops.filter((s) => s.lat != null && s.lng != null)
    const wanted = new Set(comCoord.map((s) => s.id))

    // Quando o conjunto de pedidos muda (ex.: chegou um pedido pronto novo),
    // re-centraliza o mapa pra enquadrar todos os pontos atuais.
    const stopsKey = comCoord.map((s) => s.id).sort().join(',')
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
    for (const stop of comCoord) {
      const pos = new google.maps.LatLng(stop.lat!, stop.lng!)
      bounds.extend(pos)
      const existing = stopMarkersRef.current.get(stop.id)
      if (existing) {
        existing.setIcon(pinIcon(stop.label, stop.color))
        existing.setPosition(pos)
        continue
      }
      const marker = new google.maps.Marker({ map, position: pos, icon: pinIcon(stop.label, stop.color), zIndex: 50 })
      if (stop.clickable) marker.addListener('click', () => clickRef.current(stop.id))
      stopMarkersRef.current.set(stop.id, marker)
    }

    if (fittedRef.current) return
    if (bounds.isEmpty()) {
      // Nenhum pedido com coordenada: fica na loja.
      if (posLoja) { map.setCenter(posLoja); map.setZoom(ZOOM_LOJA) }
      return
    }
    fittedRef.current = true
    // Enquadra a loja junto com os pedidos.
    if (posLoja) bounds.extend(posLoja)
    if (comCoord.length === 1 && !posLoja) {
      map.setCenter(bounds.getCenter())
      map.setZoom(15)
    } else {
      map.fitBounds(bounds, 64)
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
