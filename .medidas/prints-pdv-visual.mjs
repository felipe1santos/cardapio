// Prints do PDV (redesign visual, 22/10/2026) — servidor LOCAL + login de teste do .env.local (dono da Menuzia).
// Abre um balcão "Teste PDV visual" (retirada), põe 2 itens e passa por cada forma de pagamento. NÃO lança nada.
//   node .medidas/prints-pdv-visual.mjs antes|depois
import { readFileSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2] }
const BASE = process.env.BASE ?? 'http://localhost:3001'
const fase = process.argv[2] ?? 'antes'
const DIR = `.medidas/pdv-visual/${fase}`
mkdirSync(DIR, { recursive: true })
const nav = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await (await nav.newContext({ viewport: { width: 1366, height: 768 } })).newPage()
const limpar = () => p.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.remove()))
await p.goto(`${BASE}/login`, { timeout: 180_000 })
await p.fill('input[name="email"]', process.env.SEED_ADMIN_EMAIL); await p.fill('input[name="password"]', process.env.SEED_ADMIN_PASSWORD)
await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 180_000 }), p.click('button[type="submit"]')])
await p.goto(`${BASE}/admin/pdv`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); await p.waitForTimeout(12000); await limpar()
await p.getByText('Central de balcão').first().click(); await p.waitForTimeout(4000); await limpar()
await p.locator('[data-testid="balcao-novo"]').click(); await p.waitForTimeout(1500)
await p.locator('[data-testid="balcao-modalidade-retirada"]').click()
await p.locator('[data-testid="balcao-nome"]').fill('Teste PDV visual')
await p.locator('[data-testid="balcao-abrir"]').click(); await p.waitForTimeout(6000); await limpar()
const tirar = async (nome) => {
  for (const [w, h, tag] of [[1366, 768, 'pc'], [1024, 768, 'tablet']]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700); await limpar()
    await p.screenshot({ path: `${DIR}/${tag}-${nome}.png` })
  }
  await p.setViewportSize({ width: 1366, height: 768 }); await p.waitForTimeout(400)
}
await tirar('1-vazio')
// Itens sem configuração obrigatória (não abrem janela).
const cards = p.locator('button[aria-label^="Adicionar "]').filter({ hasNotText: 'config' })
const simples = []
for (let i = 0; i < 12 && simples.length < 2; i++) {
  await cards.nth(i).click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(700)
  // Abriu janela de opções? fecha e tenta o próximo.
  if (await p.locator('[data-tela-pdv]').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(700); continue }
  simples.push(i)
}
await tirar('2-com-itens')
await cards.nth(simples[0]).click(); await p.waitForTimeout(500)
await tirar('3-item-selecionado')
for (const f of ['dinheiro', 'pix', 'credito', 'debito']) {
  const b = p.locator(`[data-testid="pdv-pag-${f}"]`)
  if (!(await b.count())) { console.log('sem botão', f); continue }
  await b.click(); await p.waitForTimeout(500)
  if (f === 'dinheiro') await p.locator('[data-testid="pdv-troco-nao"]').click().catch(() => {})
  await tirar(`4-pag-${f}`)
}
await p.locator('[data-testid="pdv-cobrar-agora"]').click().catch(() => {}); await p.waitForTimeout(400)
await tirar('5-cobrar-agora')
console.log('prints em', DIR, '| conta:', (await p.locator('[data-testid="pdv-alvo"]').innerText().catch(() => '?')))
await nav.close()
