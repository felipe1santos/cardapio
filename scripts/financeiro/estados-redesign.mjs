/**
 * Estados do redesign "estilo Meta" (item 4b): hover, clique, foco (mouse, teclado) e toque (gráfico no celular).
 * Loja local fin6-e2e (dono.fin6). Só navega e passa o mouse: nada é gravado.
 *   node scripts/financeiro/estados-redesign.mjs
 */
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(chavesLocais().DB_URL, BASE)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
async function logar(opcoes) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.fin6'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const fundo = (loc) => loc.evaluate((e) => getComputedStyle(e).backgroundColor)
try {
  const { ctx, p } = await logar({ viewport: { width: 1366, height: 860 } })
  await p.goto(`${BASE}/admin/financeiro?secao=auditoria`, { waitUntil: 'networkidle' })
  const btn = p.getByTestId('fin-verificar')
  await btn.waitFor()
  const normal = await fundo(btn)
  await btn.hover(); await p.waitForTimeout(250)
  const hover = await fundo(btn)
  await p.mouse.down(); await p.waitForTimeout(250)
  const clique = await fundo(btn)
  await p.mouse.up(); await p.mouse.move(5, 5); await p.waitForTimeout(200)
  ok('botão principal: azul #0A78BE → hover mais escuro → clique mais escuro', normal === 'rgb(10, 120, 190)' && hover === 'rgb(8, 104, 166)' && clique === 'rgb(7, 88, 144)', [normal, hover, clique].join(' → '))
  // Teclado: Tab até o botão e conferir o anel de foco.
  // O "clique" acima disparou a verificação: o botão fica desabilitado até ela terminar.
  await p.waitForFunction(() => !document.querySelector('[data-testid="fin-verificar"]').disabled, null, { timeout: 30000 })
  await p.keyboard.press('Tab'); await btn.focus(); await p.waitForTimeout(200) // tecla antes: o navegador entra no modo teclado (:focus-visible)
  const anel = await btn.evaluate((e) => { const cs = getComputedStyle(e); return { foco: document.activeElement === e, sombra: cs.boxShadow, contorno: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}` } })
  // O anel pode vir como sombra (tema) ou como contorno (regra de foco do painel) — os dois em azul #0A78BE.
  ok('foco pelo teclado: anel azul visível', anel.foco && (/10, 120, 190/.test(anel.sombra) || (/solid/.test(anel.contorno) && /10, 120, 190/.test(anel.contorno))), JSON.stringify(anel))
  // Menu lateral: hover e item ativo.
  const itemMenu = p.locator('nav[aria-label="Seções do financeiro"] button', { hasText: 'Caixa' }).first()
  const m0 = await fundo(itemMenu); await itemMenu.hover(); await p.waitForTimeout(250); const m1 = await fundo(itemMenu)
  const ativo = await p.locator('nav[aria-label="Seções do financeiro"] [aria-current="page"]').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color])
  ok('menu lateral: hover cinza e ativo azul-claro com texto azul', m0 !== m1 && ativo[0] === 'rgb(225, 237, 247)' && ativo[1] === 'rgb(8, 104, 166)', `${m0} → ${m1} · ativo ${ativo.join(' / ')}`)
  // Filtro de período: abre por cima, com teclado (Enter) e fecha com Esc.
  await p.goto(`${BASE}/admin/financeiro?secao=dashboard`, { waitUntil: 'networkidle' })
  const filtro = p.getByTestId('dash-atalho-filtro')
  await filtro.waitFor(); await filtro.focus(); await p.keyboard.press('Enter')
  const lista = p.getByTestId('dash-atalho-7d')
  const abriu = await lista.isVisible({ timeout: 3000 }).catch(() => false)
  const z = await p.locator('[data-flutuante]').last().evaluate((e) => Number(getComputedStyle(e).zIndex)).catch(() => 0)
  await p.keyboard.press('Escape'); await p.waitForTimeout(250)
  ok('filtro de período: abre pelo teclado, por cima de tudo, e fecha com Esc', abriu && z >= 9999 && !(await lista.isVisible().catch(() => false)), `z=${z}`)
  // Gráfico: hover com mouse mostra a linha vertical e o tooltip.
  const svg = p.getByTestId('dash-grafico').locator('svg')
  const box = await svg.boundingBox()
  await p.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2); await p.waitForTimeout(250)
  ok('gráfico com mouse: tooltip aparece', await p.getByTestId('dash-grafico-tooltip').isVisible())
  await ctx.close()

  // Celular: toque no gráfico abre o tooltip; toque nos botões dá o estado de clique.
  const cel = await logar({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Pixel 7'].userAgent })
  await cel.p.goto(`${BASE}/admin/financeiro?secao=dashboard`, { waitUntil: 'networkidle' })
  const g = cel.p.getByTestId('dash-grafico').locator('svg')
  await g.scrollIntoViewIfNeeded()
  const gb = await g.boundingBox()
  await cel.p.touchscreen.tap(gb.x + gb.width * 0.7, gb.y + gb.height / 2); await cel.p.waitForTimeout(300)
  ok('gráfico no celular: tooltip pelo toque', await cel.p.getByTestId('dash-grafico-tooltip').isVisible())
  const ativoCel = await cel.p.locator('nav[aria-label="Seções do financeiro"] [aria-current="page"]').boundingBox()
  ok('celular: a seção ativa aparece no menu horizontal', !!ativoCel && ativoCel.x >= 0 && ativoCel.x + ativoCel.width <= 390, JSON.stringify(ativoCel))
  await cel.ctx.close()
} finally {
  await browser.close()
}
const passou = res.filter(Boolean).length
console.log(`\nResultado: ${passou}/${res.length}`)
process.exit(passou === res.length ? 0 : 1)
