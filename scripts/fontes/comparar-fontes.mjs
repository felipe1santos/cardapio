/**
 * Fontes dentro do projeto: prints + fontes realmente carregadas pelo navegador em /login, vitrine,
 * painel (Kanban/Inter, Dashboard/Mulish) e Financeiro (Figtree). Rodar com o build antigo (Google)
 * e com o novo e comparar:  node scripts/fontes/comparar-fontes.mjs <antes|depois>
 *                           node scripts/fontes/comparar-fontes.mjs comparar
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { USU } from '../seguranca/e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const ROT = process.argv[2] ?? 'depois'
const DIR = 'docs/fontes-locais'
mkdirSync(DIR, { recursive: true })
const TELAS = [['login', '/login', false], ['vitrine', '/loja/p8-longa', false], ['kanban', '/admin/pedidos', true], ['dashboard', '/admin/dashboard', true], ['financeiro', '/admin/financeiro', true]]

if (ROT === 'comparar') {
  const a = JSON.parse(readFileSync(`${DIR}/antes.json`, 'utf8')), b = JSON.parse(readFileSync(`${DIR}/depois.json`, 'utf8'))
  let ok = true
  for (const [nome] of TELAS) {
    const fa = `${DIR}/antes-${nome}.png`, fb = `${DIR}/depois-${nome}.png`
    if (!existsSync(fa) || !existsSync(fb)) continue
    const [x, y] = await Promise.all([fa, fb].map((f) => sharp(f).resize(1366, 900, { fit: 'cover', position: 'top' }).raw().toBuffer()))
    let d = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 16) d++
    const pct = (100 * d) / x.length
    const mesmas = JSON.stringify(a[nome]) === JSON.stringify(b[nome])
    console.log(`${nome}: ${pct.toFixed(3)}% pixels diferentes · fontes carregadas iguais: ${mesmas}`, mesmas ? '' : JSON.stringify({ antes: a[nome], depois: b[nome] }))
    ok = ok && mesmas && pct < 0.5
  }
  console.log(ok ? 'IGUAIS' : 'DIFERENTES'); process.exit(ok ? 0 : 1)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
const p = await ctx.newPage()
const fontesDaRede = []
p.on('response', (r) => { if (/\.woff2(\?|$)/.test(r.url())) fontesDaRede.push(r.url()) })
const relatorio = {}
let logado = false
for (const [nome, url, precisaLogin] of TELAS) {
  if (precisaLogin && !logado) {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', USU.dono); await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    logado = true
  }
  await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(1500)
  await p.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}' })
  relatorio[nome] = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family}:${f.weight}`).sort())
  await p.screenshot({ path: `${DIR}/${ROT}-${nome}.png` })
  console.log('•', nome, relatorio[nome].join(' '))
}
relatorio._origens = [...new Set(fontesDaRede.map((u) => new URL(u).pathname.replace(/[^/]+$/, '')))]
writeFileSync(`${DIR}/${ROT}.json`, JSON.stringify(relatorio, null, 1))
console.log('origens dos woff2:', relatorio._origens)
await browser.close()
