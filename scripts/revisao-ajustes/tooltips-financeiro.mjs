/**
 * Tooltips dos gráficos do Financeiro (2026-10-06): no <body>, z-index 9999 e dentro da tela, passando o
 * mouse perto da borda direita de cada gráfico. Loja local fin6-e2e (dono.fin6). Só leitura.
 *   node scripts/revisao-ajustes/tooltips-financeiro.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const b = await chromium.launch()
let falhas = 0, total = 0
for (const vp of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
  const p = await b.newPage({ viewport: vp, hasTouch: vp.width < 500 })
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.fin6'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login')), p.click('button[type="submit"]')])
  for (const sec of ['Dashboard', 'Fluxo de Caixa', 'Caixa']) {
    await p.goto(`${BASE}/admin/financeiro`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
    for (const t of ['OK, entendi', 'Agora não', 'Depois', 'Fechar']) await p.getByRole('button', { name: t }).first().click({ timeout: 500 }).catch(() => {})
    await p.keyboard.press('Escape')
    await p.locator('nav button', { hasText: sec }).first().click({ timeout: 5000 }).catch(() => {})
    await p.waitForTimeout(2000)
    const svgs = p.locator('[data-financeiro-area] svg[role="img"]:visible')
    const n = await svgs.count()
    for (let i = 0; i < n; i++) {
      const s = svgs.nth(i); await s.scrollIntoViewIfNeeded(); const bb = await s.boundingBox(); if (!bb) continue
      if (vp.width < 500) await p.touchscreen.tap(bb.x + bb.width - 4, bb.y + bb.height / 2)
      else await p.mouse.move(bb.x + bb.width - 4, bb.y + bb.height / 2)
      await p.waitForTimeout(350)
      const r = await p.evaluate(() => [...document.querySelectorAll('[data-tooltip-grafico]')].map((t) => {
        const q = t.getBoundingClientRect()
        return { body: t.parentElement === document.body, z: getComputedStyle(t).zIndex, dentro: q.left >= 0 && q.right <= innerWidth && q.top >= 0 && q.bottom <= innerHeight, vis: getComputedStyle(t).visibility }
      }))
      if (!r.length) continue
      total++
      const bom = r.every((x) => x.body && x.z === '9999' && x.dentro && x.vis === 'visible')
      if (!bom) { falhas++; console.log('✗', vp.width, sec, i, JSON.stringify(r)) }
      if (i === 0 && vp.width > 500) await p.screenshot({ path: `C:/Users/felipe/Downloads/revisao-ajustes/depois/financeiro-tooltip-${sec.replace(/\s+/g, '-').toLowerCase()}-desktop.png` })
      await p.mouse.move(5, 5)
    }
    console.log(`${vp.width}px ${sec}: ${n} gráfico(s)`)
  }
  await p.close()
}
await b.close()
console.log(`${total} tooltip(s) conferido(s), ${falhas} falha(s)`)
process.exitCode = falhas || !total ? 1 : 0
