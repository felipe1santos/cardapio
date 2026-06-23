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
