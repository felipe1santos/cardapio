'use client'

import { useEffect, useRef, useState } from 'react'
import { definirTokenDoMapa, loadGoogleMaps } from '@/lib/maps/loader'
import { CENTRO_BRASIL, ZOOM_BRASIL, ZOOM_LOJA, type LojaDoMapa } from '@/lib/maps/loja-mapa'
import { LIGHT_MAP_STYLE } from '@/lib/maps/style'
import { buscarRota, chaveRotaPedido, podePedirRota, type Coord } from '@/lib/mapa/cliente'

export interface RouteStop {
  id: string
  numero: number
  address: string
  /** Coordenadas gravadas no pedido (servidor). Sem elas, a parada não aparece no mapa. */
  lat: number | null
  lng: number | null
}

interface RouteMapProps {
  apiKey?: string
  origin: { lat: number; lng: number } | null
  stops: RouteStop[]
  emptyMessage?: string
  className?: string
  /** Onde a loja fica: o mapa abre nela e volta para ela se a rota não sair (antes: Fortaleza fixo). */
  loja?: LojaDoMapa
  /** Token da cozinha/motoboy para /api/mapa/rota (sem sessão do painel). */
  token?: string | null
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

/** Rotas já pedidas nesta aba (chave → polyline | null): a mesma rota nunca é pedida duas vezes. */
const rotasPedidas = new Map<string, string | null>()

/**
 * Mapa estilizado Menuzia: posição do entregador e próximas paradas, na ordem da rota.
 * Sem chamada paga no navegador (docs/REGRAS-DE-CUSTO.md): paradas pelas coordenadas do servidor e a linha da
 * rota pela polyline de /api/mapa/rota, pedida só quando as paradas mudam ou o entregador anda ~110 m, e no
 * máximo 1 vez por minuto para o mesmo conjunto de paradas.
 */
export function RouteMap({ apiKey, origin, stops, emptyMessage, className, loja, token }: RouteMapProps) {
  // Motoboy/cozinha por token: o aviso de mapa carregado (contador de custo) identifica a loja. Setter idempotente.
  definirTokenDoMapa(token)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const linhaRef = useRef<google.maps.Polyline | null>(null)
  const markersRef = useRef<google.maps.Marker[]>([])
  const lastKeyRef = useRef<string>('')
  const ultimaRotaRef = useRef<{ paradas: string; em: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const carregandoLoja = loja === 'carregando'
  const dadosLoja = loja && loja !== 'carregando' ? loja : null
  const lojaLat = dadosLoja?.lat ?? null
  const lojaLng = dadosLoja?.lng ?? null

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

  const comCoord = stops.filter((s) => s.lat != null && s.lng != null)
  const origemArred = origin ? `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}` : ''
  const chaveParadas = comCoord.map((s) => `${s.id}:${s.lat!.toFixed(5)},${s.lng!.toFixed(5)}`).join('|')

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || carregandoLoja) return
    const posLoja = lojaLat !== null && lojaLng !== null ? { lat: lojaLat, lng: lojaLng } : null
    const key = `${posLoja ? `${posLoja.lat},${posLoja.lng}` : ''}#${origemArred}#${chaveParadas}`
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key
    // Até a rota chegar (ou se ela não sair), o mapa fica na loja — nunca no centro de reserva.
    const naLoja = () => { if (posLoja) { map.setCenter(posLoja); map.setZoom(ZOOM_LOJA) } }

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []
    const paradas = stops.filter((s) => s.lat != null && s.lng != null)
    const bounds = new google.maps.LatLngBounds()
    if (origin) {
      markersRef.current.push(new google.maps.Marker({ map, position: origin, icon: motoboyIcon(), zIndex: 50 }))
      bounds.extend(origin)
    }
    paradas.forEach((s, i) => {
      const pos = { lat: s.lat!, lng: s.lng! }
      markersRef.current.push(new google.maps.Marker({ map, position: pos, icon: stopPinIcon(s.numero), zIndex: 40 - i }))
      bounds.extend(pos)
    })
    if (paradas.length === 0) {
      linhaRef.current?.setMap(null)
      if (origin) { map.setCenter(origin); map.setZoom(15) } else naLoja()
      if (stops.length > 0) setError('Endereço da entrega sem localização no mapa.')
      return
    }
    setError(null)
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) { map.setCenter(bounds.getCenter()); map.setZoom(15) } else map.fitBounds(bounds, 48)

    // Linha da rota: só com origem (ou 2+ paradas), pelo servidor, com cache e limite de frequência.
    const origemRota: Coord | null = origin ?? (paradas.length >= 2 ? { lat: paradas[0].lat!, lng: paradas[0].lng! } : null)
    const destinoParadas = (origin ? paradas : paradas.slice(1)).map((s) => ({ lat: s.lat!, lng: s.lng! }))
    if (!origemRota || destinoParadas.length === 0) { linhaRef.current?.setMap(null); return }
    const chave = chaveRotaPedido(origemRota, destinoParadas)
    const desenhar = (poly: string | null) => {
      linhaRef.current?.setMap(null)
      if (!poly) { setError('Rota indisponível no momento.'); return }
      try {
        const path = google.maps.geometry.encoding.decodePath(poly)
        linhaRef.current = new google.maps.Polyline({
          map, path, strokeOpacity: 0,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3, strokeColor: '#0688D4' }, offset: '0', repeat: '12px' }],
        })
      } catch { setError('Rota indisponível no momento.') }
    }
    if (rotasPedidas.has(chave)) { desenhar(rotasPedidas.get(chave) ?? null); return }
    if (!podePedirRota(ultimaRotaRef.current, chaveParadas, Date.now())) return
    ultimaRotaRef.current = { paradas: chaveParadas, em: Date.now() }
    void buscarRota(origemRota, destinoParadas, token).then((r) => {
      rotasPedidas.set(chave, r.polyline) // guarda antes de tudo (falha também: não pede de novo nesta aba)
      if (mapRef.current === map) desenhar(r.polyline)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, carregandoLoja, lojaLat, lojaLng, origemArred, chaveParadas, token])

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
