let loaderPromise: Promise<typeof google> | null = null
let tokenMapa: string | null = null

/**
 * Telas sem sessão do painel (cozinha por token, motoboy pelo link) informam o token antes de carregar o mapa:
 * o aviso de "mapa carregado" (contador de custo do Super Admin) identifica a loja por ele.
 */
export function definirTokenDoMapa(token: string | null | undefined) {
  if (token) tokenMapa = token
}

/** Avisa o servidor UMA vez por carregamento do script (é o que o Google cobra). Falhar não atrapalha o mapa. */
function avisarCarregou() {
  try {
    void fetch('/api/mapa/carregou', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify(tokenMapa ? { token: tokenMapa } : {}),
    }).catch(() => {})
  } catch { /* sem rede: só não conta */ }
}

/** Injeta o script da Google Maps JavaScript API uma única vez e reaproveita entre componentes. */
export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Maps só pode ser carregado no navegador.'))
  if (window.google?.maps) return Promise.resolve(window.google)
  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = '__menuziaGoogleMapsLoaded'
    ;(window as unknown as Record<string, () => void>)[callbackName] = () => { avisarCarregou(); resolve(window.google) }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&callback=${callbackName}`
    script.async = true
    script.onerror = () => reject(new Error('Não foi possível carregar o Google Maps.'))
    document.head.appendChild(script)
  })

  return loaderPromise
}
