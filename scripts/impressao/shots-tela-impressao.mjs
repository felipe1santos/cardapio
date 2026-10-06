/**
 * Prints da tela Impressão (servidor LOCAL), em computador e celular, para o antes/depois.
 *
 *   node scripts/impressao/shots-tela-impressao.mjs <rotulo>     (ex.: antes, depois)
 *
 * Saída: docs/impressao-tela-nova/<rotulo>-<largura>.png (página inteira) e, no "depois",
 * os modais de prévia (comanda, pré-conta, via da cozinha) em 1366 e 390.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { USU } from '../seguranca/e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('só servidor local')
const ROTULO = process.argv[2] ?? 'depois'
const SAIDA = 'docs/impressao-tela-nova'
mkdirSync(SAIDA, { recursive: true })

const browser = await chromium.launch()
try {
  for (const [w, h] of [[1366, 900], [430, 900], [390, 844], [360, 780]]) {
    if (ROTULO === 'antes' && (w === 430 || w === 360)) continue
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', deviceScaleFactor: 1 })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', USU.dono)
    await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
    await p.waitForTimeout(1500)
    // O <main> não rola: estica o contêiner da página para o print pegar tudo.
    await p.evaluate(() => {
      for (const el of document.querySelectorAll('[data-testid="impressao-rolagem"], main, [data-admin-shell], [data-admin-shell] > div')) {
        el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'
      }
      document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'
    })
    await p.screenshot({ path: `${SAIDA}/${ROTULO}-${w}.png`, fullPage: true })
    if (ROTULO !== 'antes') {
      await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(1200)
      for (const doc of ['comanda', 'pre_conta', 'via_cozinha']) {
        const b = p.getByTestId(`ver-${doc}`)
        if (!(await b.count()) || !(await b.isVisible())) continue
        await b.click()
        await p.getByTestId('modal-previa').waitFor({ timeout: 10000 })
        await p.waitForTimeout(800)
        await p.screenshot({ path: `${SAIDA}/${ROTULO}-modal-${doc}-${w}.png` })
        await p.keyboard.press('Escape')
        await p.waitForTimeout(300)
      }
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log('prints em', SAIDA)
