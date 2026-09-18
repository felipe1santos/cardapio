/**
 * Ajustes › QR Code com o módulo de mesas ligado: o link de cada mesa abre o cardápio
 * da MESA (autoatendimento), e o QR da vitrine fica identificado como delivery.
 * Só loopback.
 *
 *   node scripts/seguranca/verificar-qr-ajustes.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })
mkdirSync('.shots', { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' })
const page = await ctx.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[name="email"]', 'dono.local')
await page.fill('input[name="password"]', 'demo-local-123456')
await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), page.click('button[type="submit"]')])
await page.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
const okEntendi = page.locator('button', { hasText: 'OK, entendi' })
if (await okEntendi.count()) await okEntendi.first().click()
await page.getByRole('button', { name: 'QR Code', exact: true }).first().click()
await page.getByText('QR Code das mesas').waitFor({ timeout: 15000 })
await page.getByRole('link', { name: /Abrir o cardápio da Mesa 01/ }).waitFor({ timeout: 15000 })

const links = await page.locator('a[aria-label^="Abrir o cardápio da"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
ok('cada mesa ativa tem o seu link', links.length >= 3, `${links.length} link(s)`)
ok('todos os links são de mesa (/mesa/<token>)', links.every((h) => /\/mesa\/[0-9a-f-]{36}$/.test(h ?? '')))
ok('os links são diferentes entre si', new Set(links).size === links.length)
const texto = await page.locator('main').innerText()
ok('o QR da vitrine fica identificado como delivery', /QR Code do delivery/.test(texto))
ok('não oferece mais "nome da mesa" na etiqueta do delivery', !/Selecione as mesas para imprimir o nome/.test(texto))
await page.screenshot({ path: '.shots/qr-ajustes-mesas.png', fullPage: true })

const mesa = await ctx.newPage()
const r = await mesa.goto(links[0], { waitUntil: 'networkidle' })
const tMesa = await mesa.locator('body').innerText()
ok('o link abre o cardápio da mesa, não a vitrine', r.status() === 200 && /Nada foi enviado para a cozinha/.test(tMesa) && /Garçom/.test(tMesa), `HTTP ${r.status()}`)

await browser.close()
const falhas = res.filter((x) => !x).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
