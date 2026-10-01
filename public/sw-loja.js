/*
 * Service worker do app do cardápio de UMA loja (0127, 2026-10-01). Registrado pela vitrine com
 * escopo /loja/<slug>: cada loja tem o seu registro e, portanto, a sua assinatura de push, mesmo
 * todas morando em app.menuzia.com.br. Sem cache e sem interceptar requisições (a vitrine continua
 * indo à rede): só recebe push, mostra a notificação e trata o toque.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function slugDoEscopo() {
  const m = new URL(self.registration.scope).pathname.match(/\/loja\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch (e) { d = { title: 'Novidade', body: event.data ? event.data.text() : '' } }
  const slug = (d.data && d.data.loja) || slugDoEscopo()
  const opcoes = {
    body: d.body || '',
    icon: d.icon || `/api/loja/${slug}/icone/192`,
    badge: d.badge || `/api/loja/${slug}/push/badge`,
    tag: d.tag || slug,
    renotify: Boolean(d.tag),
    data: { url: (d.data && d.data.url) || `/loja/${slug}`, envio: d.data && d.data.envio },
    lang: 'pt-BR',
  }
  if (d.image) opcoes.image = d.image
  // userVisibleOnly: todo push vira notificação visível (iOS e Chrome exigem). As abas abertas da
  // loja também ficam sabendo (a vitrine pode atualizar o status do pedido na hora).
  event.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Novidade', opcoes),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ tipo: 'menuzia-push', title: d.title, body: d.body, url: opcoes.data.url }))),
  ]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const destino = new URL((event.notification.data && event.notification.data.url) || self.registration.scope, self.location.origin).href
  event.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const escopo = self.registration.scope.replace(/\/$/, '')
    // Uma aba/app desta loja já aberta: leva para o destino e traz para frente.
    for (const c of abertas) {
      if (c.url.startsWith(escopo) && 'focus' in c) {
        try { await c.navigate(destino) } catch (e) { /* aba de outra origem/estado: abre nova */ }
        return c.focus()
      }
    }
    return self.clients.openWindow(destino)
  })())
})

// O navegador trocou a assinatura (expirou/renovou): assina de novo e avisa o servidor.
self.addEventListener('pushsubscriptionchange', (event) => {
  const slug = slugDoEscopo()
  event.waitUntil((async () => {
    const cfg = await fetch(`/api/loja/${slug}/push/config`).then((r) => r.json()).catch(() => null)
    if (!cfg || !cfg.ativo) return
    const chave = Uint8Array.from(atob(cfg.chavePublica.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((cfg.chavePublica.length + 3) % 4)), (c) => c.charCodeAt(0))
    const nova = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })
    await fetch(`/api/loja/${slug}/push/assinar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: nova.toJSON(), plataforma: 'outro' }),
    })
  })())
})
