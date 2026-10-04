/**
 * Prints do topo do painel (Kanban e telas principais) — loja local ordem-qr-e2e.
 *   node scripts/seguranca/kanban-topo-v2-prints.mjs <pasta> <prefixo>
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const [pasta = 'docs/kanban-topo-v2/prints', prefixo = 'antes'] = process.argv.slice(2)
mkdirSync(pasta, { recursive: true })
const TELAS = [['pdv', '/admin/pdv'], ['mesas', '/admin/mesas'], ['cardapio', '/admin/cardapio'], ['clientes', '/admin/clientes'], ['financeiro', '/admin/financeiro'], ['integracoes', '/admin/integracoes']]
const b = await chromium.launch()
try {
  for (const [nome, vp, extra] of [
    ['1920', { width: 1920, height: 1000 }, {}],
    ['1366', { width: 1366, height: 768 }, {}],
    ['tablet', { width: 1024, height: 768 }, { isMobile: true, hasTouch: true }],
    ['celular', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }],
  ]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...extra })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await p.waitForTimeout(2000)
    const topo = async (arq) => { const h = await p.locator('header').first().boundingBox({ timeout: 3000 }).catch(() => null); await p.screenshot({ path: join(pasta, arq), clip: { x: 0, y: 0, width: vp.width, height: Math.min(vp.height, Math.ceil((h?.y ?? 0) + (h?.height ?? 80)) + 8) } }) }
    await topo(`${prefixo}-kanban-topo-${nome}.png`)
    await p.screenshot({ path: join(pasta, `${prefixo}-kanban-${nome}.png`) })
    // Popup de avisos aberto (era o que ficava tampado/cortado).
    await p.getByTestId('avisos-icone').click().catch(() => {})
    await p.waitForTimeout(500)
    await p.screenshot({ path: join(pasta, `${prefixo}-avisos-${nome}.png`) })
    await p.keyboard.press('Escape')
    await p.getByTestId('kanban-mais').click().catch(() => {})
    await p.waitForTimeout(400)
    await p.screenshot({ path: join(pasta, `${prefixo}-mais-${nome}.png`) })
    await p.keyboard.press('Escape')
    // Topo das outras telas (1366 e celular).
    if (nome === '1366' || nome === 'celular') {
      for (const [t, url] of TELAS) {
        await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {})
        await p.waitForTimeout(1200)
        await topo(`${prefixo}-topo-${t}-${nome}.png`)
      }
    }
    await ctx.close()
  }
} finally {
  await b.close()
}
console.log('prints ok')
