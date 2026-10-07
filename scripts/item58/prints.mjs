/**
 * Prints do item 58 (antes/depois): Logística/Pedidos, Kanban, Equipe, Financeiro › Fluxo de caixa,
 * Dashboard — 1366 e 390. Loja local (dono.finint).
 *   node scripts/item58/prints.mjs <pasta> <sufixo>
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const [pasta = 'C:/Users/felipe/Downloads/revisao-item58', suf = 'antes'] = process.argv.slice(2)
mkdirSync(pasta, { recursive: true })
const ROTAS = [
  ['logistica', '/admin/lista-pedidos'],
  ['kanban', '/admin/pedidos'],
  ['equipe', '/admin/equipe'],
  ['fluxo-caixa', '/admin/financeiro?secao=fluxo'],
  ['dashboard', '/admin/dashboard'],
]
const b = await chromium.launch()
for (const [w, h, rot] of [[1366, 900, '1366'], [390, 844, '390']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.finint'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  for (const [nome, rota] of ROTAS) {
    await p.goto(`${BASE}${rota}`, { waitUntil: 'load' }).catch(() => {})
    await p.waitForTimeout(3000)
    for (const t of ['OK, ENTENDI', 'OK, entendi', 'Agora não']) { const x = p.getByText(t, { exact: true }); if (await x.first().isVisible().catch(() => false)) await x.first().click().catch(() => {}) }
    await p.waitForTimeout(500)
    await p.screenshot({ path: join(pasta, `${nome}-${rot}-${suf}.png`) })
  }
  await ctx.close()
}
await b.close()
console.log('prints em', pasta)
