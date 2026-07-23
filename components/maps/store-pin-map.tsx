'use client'

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '@/lib/maps/loader'
import { LIGHT_MAP_STYLE } from '@/lib/maps/style'

interface StorePinMapProps {
  apiKey?: string
  /** Endereço composto (rua, número, bairro, cidade, UF) usado pro geocode automático. */
  address: string
  lat: number | null
  lng: number | null
  /** Chamado tanto pelo geocode automático quanto pelo arraste manual do pin. */
  onChange: (lat: number, lng: number) => void
  className?: string
}

const FALLBACK_CENTER = { lat: -3.73, lng: -38.53 }

/** Mapa com um único PIN arrastável pro dono conferir/ajustar a localização da loja. */
export function StorePinMap({ apiKey, address, lat, lng, onChange, className }: StorePinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Endereço já processado (no geocode automático ou como valor inicial no mount) —
  // evita regeocodificar (e sobrescrever um ajuste manual) sem o texto ter mudado de fato.
  const lastAddressRef = useRef<string>(address)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Incrementado a cada arraste manual do pin — usado pra descartar um geocode
  // atrasado que resolveria depois de um arraste mais recente (senão ele sobrescreveria
  // a correção manual do dono com uma posição desatualizada).
  const dragVersionRef = useRef(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!apiKey || !containerRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        const center = lat != null && lng != null ? { lat, lng } : FALLBACK_CENTER
        const map = new google.maps.Map(containerRef.current, {
          center,
          zoom: lat != null && lng != null ? 16 : 12,
          styles: LIGHT_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
        })
        const marker = new google.maps.Marker({ map, position: center, draggable: true })
        marker.addListener('dragend', () => {
          const pos = marker.getPosition()
          if (!pos) return
          dragVersionRef.current += 1
          onChangeRef.current(pos.lat(), pos.lng())
        })
        mapRef.current = map
        markerRef.current = marker
        setReady(true)
      })
      .catch(() => setError('Não foi possível carregar o mapa.'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey])

  // Reposiciona o marker quando lat/lng mudam externamente (geocode automático ou
  // carregamento inicial de uma loja já cadastrada).
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!ready || !map || !marker || lat == null || lng == null) return
    const pos = { lat, lng }
    marker.setPosition(pos)
    map.setCenter(pos)
    map.setZoom(16)
  }, [ready, lat, lng])

  // Geocodifica o endereço (debounced) sempre que o texto mudar de verdade — não
  // dispara no primeiro render (lastAddressRef já começa igual ao address inicial),
  // então um PIN ajustado manualmente só é sobrescrito se o dono editar o endereço.
  useEffect(() => {
    if (!ready || !address.trim() || address === lastAddressRef.current) return
    lastAddressRef.current = address
    // Captura a versão do arraste no momento em que o debounce é AGENDADO (não quando
    // ele dispara) — assim um arraste feito durante a espera do debounce, ou durante a
    // latência da própria chamada de geocode, invalida o resultado atrasado nos dois casos.
    const versionAtSchedule = dragVersionRef.current
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode({ address, region: 'BR' }, (results, status) => {
        // Um arraste manual aconteceu desde que este geocode foi agendado — o
        // resultado chegou atrasado e está desatualizado, descarta sem mostrar erro.
        if (dragVersionRef.current !== versionAtSchedule) return
        if (status !== google.maps.GeocoderStatus.OK || !results?.[0]) {
          setError('Não foi possível localizar esse endereço no mapa — ajuste o pin manualmente.')
          return
        }
        setError(null)
        const pos = results[0].geometry.location
        onChangeRef.current(pos.lat(), pos.lng())
      })
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [ready, address])

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
      {error && (
        <div className="absolute inset-x-2 bottom-2 rounded-menuzia bg-white/95 px-3 py-1.5 text-center text-[11px] font-medium text-danger shadow">
          {error}
        </div>
      )}
    </div>
  )
}
