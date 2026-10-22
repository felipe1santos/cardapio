// Prints do Kanban com os pedidos de DEMONSTRAÇÃO dos apps (pedidos-fake-apps.mjs) e da cotação ao vivo dos
// entregadores conectados (Uber em TESTE). Não confirma nenhuma corrida. SÓ Menuzia.
//   node .medidas/prints-pedidos-apps.mjs <senha do gerente.aprovador>
import { chromium } from 'playwright'
const BASE = 'https://app.menuzia.com.br'
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', 'gerente.aprovador'); await p.fill('input[name="password"]', process.argv[2])
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }), p.click('button[type="submit"]')])
const ativos = await (await p.request.get(`${BASE}/api/admin/entregas/ativos`)).json()
console.log('entregadores conectados:', ativos.ativos, '| Pix online:', ativos.pixOnline)
await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(10000)
await p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
await p.screenshot({ path: '.medidas/apps-1-kanban.png' })
for (const num of process.argv.slice(3)) {
  const card = p.locator(`[data-testid="pedido-${num}"]`).first()
  await card.scrollIntoViewIfNeeded().catch(() => {})
  for (const prov of ativos.ativos) {
    const b = card.locator(`[data-testid="card-${prov}"]`)
    if (!(await b.count())) { console.log(`#${num} ${prov}: sem botão`); continue }
    await b.click(); await p.waitForTimeout(7000)
    const menu = p.locator(`[data-testid="lalamove-menu-${num}"]`)
    console.log(`#${num} ${prov}:`, (await menu.innerText().catch(() => '?')).replace(/\n+/g, ' | ').slice(0, 260))
    await p.screenshot({ path: `.medidas/apps-cotacao-${num}-${prov}.png` })
    await p.keyboard.press('Escape'); await p.waitForTimeout(800)
  }
}
// Despachar: menu de entregadores próprios do primeiro pedido pronto
const prim = p.locator(`[data-testid="pedido-${process.argv[3]}"]`).first()
await prim.getByText('Despachar', { exact: false }).first().click().catch(() => {}); await p.waitForTimeout(1500)
await p.screenshot({ path: '.medidas/apps-despachar.png' })
await nav.close()
