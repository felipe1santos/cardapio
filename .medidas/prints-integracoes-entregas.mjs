// Integrações › Entregas (21/10/2026): cards da Uber Direct e da Borzo. Servidor local + login de teste do .env.local.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = process.env.BASE ?? 'http://localhost:3001'
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1366, height: 860 } })).newPage()
await p.goto(`${BASE}/login`, { timeout: 180_000 })
await p.fill('input[name="email"]', process.env.SEED_ADMIN_EMAIL); await p.fill('input[name="password"]', process.env.SEED_ADMIN_PASSWORD)
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180_000 }), p.click('button[type="submit"]')])
await p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); await p.waitForTimeout(10_000)
await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
const corpo = await p.locator('body').innerText()
console.log('Uber:', corpo.includes('Uber Direct'), '| Borzo:', corpo.includes('Borzo'))
await p.screenshot({ path: '.medidas/integracoes-lista.png', fullPage: true })
for (const [nome, arq] of [['Uber Direct', 'uber'], ['Lalamove', 'lalamove']]) {
  await p.getByText(nome, { exact: true }).first().click(); await p.waitForTimeout(8000)
  await p.screenshot({ path: `.medidas/integracoes-${arq}.png` })
  console.log(nome, '→', (await p.locator('[role="dialog"]').last().innerText().catch(() => '')).slice(0, 220).replace(/\n/g, ' | '))
  await p.keyboard.press('Escape'); await p.waitForTimeout(800)
}
await nav.close()
