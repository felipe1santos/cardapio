// Service worker mínimo do Menuzia.
// Objetivo: tornar o painel "instalável" (PWA). Não faz cache do app shell de
// propósito — o Next serve chunks versionados e cache agressivo causaria telas
// velhas após deploy. O handler de fetch existe só porque o Chrome exige um
// para oferecer a instalação; ele apenas deixa a requisição seguir normal.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // pass-through: sem respondWith, o navegador trata a requisição normalmente
})

// Push do PAINEL (2026-10-04, 0146): pedido novo com o celular/tablet de tela apagada ou o Chrome em
// segundo plano. Mesma tag da notificação do navegador ("menuzia-pedido"): se as duas chegarem, o
// aparelho mostra uma só. Vibra e fica na tela até alguém tocar.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (e) { d = { title: 'Pedido novo', body: event.data ? event.data.text() : '' } }
  const url = (d.data && d.data.url) || '/admin/pedidos'
  event.waitUntil(self.registration.showNotification(d.title || '🔔 Pedido novo', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'menuzia-pedido',
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400],
    data: { url },
    lang: 'pt-BR',
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = new URL((event.notification.data && event.notification.data.url) || '/admin/pedidos', self.location.origin).href
  event.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of abertas) {
      if (new URL(c.url).pathname.startsWith('/admin') && 'focus' in c) {
        try { await c.navigate(destino) } catch (e) { /* segue com o foco */ }
        return c.focus()
      }
    }
    return self.clients.openWindow(destino)
  })())
})

// O navegador trocou a assinatura: assina de novo e avisa o servidor (sessão do painel vai no cookie).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const cfg = await fetch('/api/admin/pedidos/push-painel', { credentials: 'include' }).then((r) => r.json()).catch(() => null)
    if (!cfg || !cfg.disponivel) return
    const b64 = cfg.chavePublica.replace(/-/g, '+').replace(/_/g, '/')
    const chave = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0))
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })
    await fetch('/api/admin/pedidos/push-painel', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
  })())
})
