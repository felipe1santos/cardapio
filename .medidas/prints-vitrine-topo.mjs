// Prints da vitrine no celular (21/10/2026): topo, "Mais Pedidos" e um item aberto. BASE padrão: servidor local.
//   BASE=https://app.menuzia.com.br node .medidas/prints-vitrine-topo.mjs [slug]
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:3001'
const slug = process.argv[2] ?? 'menuzia'
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })).newPage()
await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
await p.waitForSelector('[data-testid="nav-botoes"]', { timeout: 180_000 })
await p.waitForTimeout(4000)
await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
const fechar = p.getByText('Continuar no cardápio'); if (await fechar.count()) { await fechar.first().click(); await p.waitForTimeout(800) }
await p.screenshot({ path: '.medidas/vitrine-topo.png' })
const mais = p.getByText('Mais Pedidos').first()
if (await mais.count()) { await mais.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -120)); await p.waitForTimeout(2500) }
await p.screenshot({ path: '.medidas/vitrine-mais-pedidos.png' })
const card = p.locator('button[data-item-id]').first()
await card.click(); await p.waitForTimeout(2500)
await p.screenshot({ path: '.medidas/vitrine-item.png' })
await nav.close()
console.log('prints ok')
