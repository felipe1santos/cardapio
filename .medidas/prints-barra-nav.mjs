// Barra de baixo da vitrine (21/10/2026): quadros do deslizar da bolha, no celular. BASE padrão: servidor local.
import { chromium } from 'playwright'
const BASE = process.env.BASE ?? 'http://localhost:3001'
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })).newPage()
await p.goto(`${BASE}/loja/menuzia`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
await p.waitForSelector('[data-testid="nav-botoes"]', { timeout: 180_000 })
await p.waitForTimeout(4000)
await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
const fechar = p.getByText('Continuar no cardápio'); if (await fechar.count()) { await fechar.first().click(); await p.waitForTimeout(800) }
const clip = { x: 0, y: 700, width: 390, height: 144 }
await p.screenshot({ path: '.medidas/barra-0-home.png', clip })
await p.click('[data-testid="nav-botoes"] button[aria-label="Cupons"]', { force: true })
for (const ms of [120, 240, 600]) { await p.waitForTimeout(ms === 120 ? 120 : ms - 120); await p.screenshot({ path: `.medidas/barra-${ms}.png`, clip }) }
await p.click('[data-testid="nav-botoes"] button[aria-label="Entrar"]', { force: true })
await p.waitForTimeout(700)
await p.screenshot({ path: '.medidas/barra-perfil.png' })
await nav.close()
