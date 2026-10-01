/**
 * Prints do Dashboard (filtro de período + aviso do rastreio), antes × depois (2026-10-01).
 * Stack local, cantina-e2e (dono.e2e). Desktop, tablet e celular.
 *
 *   node scripts/dashboard/prints-filtro.mjs <antes|depois>
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const FASE = process.argv[2] ?? 'antes'
const DIR = join('docs/dashboard-filtro/prints', FASE)
mkdirSync(DIR, { recursive: true })
const browser = await chromium.launch()
try {
  for (const [nome, w, h] of [['desktop', 1366, 768], ['tablet', 820, 1180], ['celular', 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.e2e')
    await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: /ok, entendi/i }).click({ timeout: 2000 }).catch(() => {})
    await p.waitForTimeout(1500)
    await p.screenshot({ path: join(DIR, `${nome}.png`) })
    if (FASE === 'depois') {
      const botao = p.getByRole('button', { name: 'Escolher o período do dashboard' })
      const caixa = await botao.boundingBox()
      const rotulo = (await botao.innerText()).trim()
      const ini = new Date(Date.now() - 29 * 864e5).toLocaleDateString('pt-BR')
      const larguraOk = nome === 'celular' ? caixa.width > w - 100 : caixa.width >= 280 && caixa.width <= 400
      const azul = await p.getByText('são contadas a partir da ativação do rastreio').count()
      console.log(`${nome}: largura ${Math.round(caixa.width)}px ${larguraOk ? 'OK' : 'FALHA'} · rótulo "${rotulo}" ${rotulo.startsWith(ini) ? 'OK (30 dias)' : 'FALHA'} · faixa azul visível: ${azul}`)
      const info = p.locator('[data-dashboard-info]')
      if (await info.count()) {
        await info.click()
        await p.waitForTimeout(300)
        await p.screenshot({ path: join(DIR, `${nome}-info.png`) })
        await info.click()
      }
    }
    await p.getByRole('button', { name: 'Escolher o período do dashboard' }).click()
    await p.waitForTimeout(300)
    await p.screenshot({ path: join(DIR, `${nome}-calendario.png`) })
    if (FASE === 'depois') {
      await p.getByRole('button', { name: '7 dias', exact: true }).click()
      await p.waitForTimeout(800)
      const r7 = (await p.getByRole('button', { name: 'Escolher o período do dashboard' }).innerText()).trim()
      const i7 = new Date(Date.now() - 6 * 864e5).toLocaleDateString('pt-BR')
      const info2 = await p.locator('[data-dashboard-info]').count()
      console.log(`  ${nome}: escolher 7 dias → "${r7}" ${r7.startsWith(i7) ? 'OK' : 'FALHA'} · ícone ⓘ presente: ${info2}`)
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log('prints em', DIR)
