let loaderPromise: Promise<typeof google> | null = null

/** Injeta o script da Google Maps JavaScript API uma única vez e reaproveita entre componentes. */
export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Maps só pode ser carregado no navegador.'))
  if (window.google?.maps) return Promise.resolve(window.google)
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = '__menuziaGoogleMapsLoaded'
    ;(window as unknown as Record<string, () => void>)[callbackName] = () => resolve(window.google)

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&callback=${callbackName}`
    script.async = true
    script.onerror = () => reject(new Error('Não foi possível carregar o Google Maps.'))
    document.head.appendChild(script)
  })

  return loaderPromise
}
