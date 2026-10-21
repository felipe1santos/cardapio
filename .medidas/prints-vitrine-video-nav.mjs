// Prints da vitrine da Menuzia no celular (21/10/2026): banner com vídeo, card com vídeo, barra com bolha e ficha.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:3001'
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })).newPage()
await p.goto(`${BASE}/loja/menuzia`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
await p.waitForSelector('[data-testid="nav-botoes"]', { timeout: 180_000 })
await p.waitForTimeout(5000)
const info = await p.evaluate(() => [...document.querySelectorAll('video')].map((v) => ({ src: (v.currentSrc || v.getAttribute('src') || '').slice(-20), pausado: v.paused, t: +v.currentTime.toFixed(2) })))
console.log('vídeos na home', JSON.stringify(info))
await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
const fechar = p.getByText('Continuar no cardápio'); if (await fechar.count()) { await fechar.first().click(); await p.waitForTimeout(800) }
await p.screenshot({ path: '.medidas/vitrine-1-home.png' })
await p.click('[data-testid="nav-botoes"] button[aria-label="Pedidos"]', { force: true })
await p.waitForTimeout(200)
await p.screenshot({ path: '.medidas/vitrine-2-transicao.png', clip: { x: 0, y: 700, width: 390, height: 144 } })
await p.waitForTimeout(700)
await p.screenshot({ path: '.medidas/vitrine-3-pedidos.png', clip: { x: 0, y: 700, width: 390, height: 144 } })
await p.click('[data-testid="nav-botoes"] button[aria-label="Home"]', { force: true })
await p.waitForTimeout(800)
const card = p.locator('button[data-item-id]:has([data-testid="video-loop"])').first()
if (await card.count()) { await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(2500); await p.screenshot({ path: '.medidas/vitrine-4-card.png' }); await p.evaluate(() => window.scrollBy(0, 200)); await card.click() }
await p.waitForTimeout(2500)
await p.screenshot({ path: '.medidas/vitrine-5-ficha.png' })
console.log('na ficha', await p.locator('[data-testid="fotos-carrossel"] video').count(), 'vídeo(s) no carrossel')
await nav.close()
