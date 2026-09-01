// Service worker do portal do entregador (escopo /entregador/).
//
// O portal roda no celular do motoboy, que perde sinal o tempo todo. O objetivo
// aqui é sobreviver a isso sem nunca mostrar dado operacional velho.
//
// Três estratégias, por tipo de requisição:
//
//   /api/*        rede e só rede. Lista de pedidos, heartbeat, "peguei"/"entreguei".
//                 Servir isso do cache faria o entregador ver pedido já entregue
//                 ou reatribuído — pior que mostrar erro de conexão.
//
//   imagens       cache primeiro. Os objetos do Storage têm UUID no caminho e
//                 max-age de um ano: uma URL nunca muda de conteúdo, então o que
//                 está em cache está sempre correto. Também é o que mantém a
//                 tela apresentável quando o sinal cai.
//
//   resto         rede primeiro, cache como rede de segurança (app shell).

const CACHE_NAME = 'motoboy-v2'
const PRECACHE = ['/icons/motoboy-192.png', '/icons/motoboy-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  )
  self.clients.claim()
})

/** Objeto imutável do Storage, ou ícone/imagem local. */
function ehImagem(url, request) {
  if (request.destination === 'image') return true
  return url.pathname.includes('/storage/v1/object/public/') || /\.(png|jpg|jpeg|webp|avif|svg|ico)$/i.test(url.pathname)
}

async function guardar(request, response) {
  // Só resposta completa e utilizável entra no cache.
  if (!response || !response.ok) return
  const cache = await caches.open(CACHE_NAME)
  await cache.put(request, response.clone())
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Dados operacionais: nunca do cache, em nenhuma hipótese.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return

  if (ehImagem(url, request)) {
    event.respondWith(
      caches.match(request).then((cacheada) => {
        if (cacheada) return cacheada
        return fetch(request).then((resposta) => {
          void guardar(request, resposta)
          return resposta
        })
      })
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then((resposta) => {
        void guardar(request, resposta)
        return resposta
      })
      .catch(() => caches.match(request))
  )
})
