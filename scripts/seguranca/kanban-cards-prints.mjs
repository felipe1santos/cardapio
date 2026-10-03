/**
 * Prints do Kanban (cards) em desktop, tablet e celular — loja local ordem-qr-e2e.
 *   node scripts/seguranca/kanban-cards-prints.mjs <pasta> <prefixo>
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const [pasta = 'docs/kanban-card/prints', prefixo = 'antes'] = process.argv.slice(2)
mkdirSync(pasta, { recursive: true })
const b = await chromium.launch()
try {
  for (const [nome, vp] of [['desktop', { width: 1600, height: 1000 }], ['tablet', { width: 1024, height: 900 }], ['celular', { width: 390, height: 900 }]]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2000 }).catch(() => {})
    await p.waitForTimeout(2500)
    await p.screenshot({ path: join(pasta, `${prefixo}-${nome}.png`), fullPage: nome === 'celular' })
    // Close de um card de cada coluna (desktop).
    if (nome === 'desktop') {
      for (const [i, n] of ['recebido', 'preparando', 'pronto'].entries()) {
        const card = p.locator('[data-testid^="pedido-"]').filter({ hasText: ['TESTE Card Entrega Dinheiro', 'TESTE Card PDV', 'TESTE Card Parado'][i] }).first()
        if (await card.count()) await card.screenshot({ path: join(pasta, `${prefixo}-card-${n}.png`) })
      }
    }
    await ctx.close()
  }
} finally {
  await b.close()
}
console.log('prints ok')
