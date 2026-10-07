/**
 * Prints do menu lateral principal (item 5, noite 5) — desktop e celular (gaveta aberta).
 *   node scripts/menu/prints-menu.mjs <pasta> <sufixo>
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const [pasta = '.shots/menu', suf = 'antes'] = process.argv.slice(2)
mkdirSync(pasta, { recursive: true })
const b = await chromium.launch()
async function logar(ctx) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.finint'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return p
}
const fecharAvisos = async (p) => { for (const t of ['OK, ENTENDI', 'OK, entendi', 'Agora não']) { const x = p.getByText(t, { exact: true }); if (await x.first().isVisible().catch(() => false)) await x.first().click().catch(() => {}) } }
{
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } })
  const p = await logar(ctx)
  for (const rota of ['/admin/dashboard', '/admin/campanhas']) {
    await p.goto(`${BASE}${rota}`, { waitUntil: 'load' }); await p.waitForTimeout(2500); await fecharAvisos(p); await p.waitForTimeout(500)
    await p.locator('aside').first().screenshot({ path: join(pasta, `menu-${rota.split('/').pop()}-1366-${suf}.png`) })
  }
  await ctx.close()
}
{
  const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
  const p = await logar(ctx)
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'load' }); await p.waitForTimeout(2500); await fecharAvisos(p)
  const abrir = p.getByRole('button', { name: /menu/i }).first()
  await abrir.click().catch(() => {}); await p.waitForTimeout(800)
  await p.screenshot({ path: join(pasta, `menu-celular-390-${suf}.png`) })
  await ctx.close()
}
await b.close()
console.log('prints em', pasta)
