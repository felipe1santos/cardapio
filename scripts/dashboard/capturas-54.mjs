/**
 * Capturas do Dashboard geral para o item 54 (análises em abas, no visual do financeiro).
 *   antes  — tudo o que está de "Análise de pedidos" para baixo, numa página só;
 *   depois — o bloco de abas (cada aba clicada; "Ver todos" aberto nos cliques).
 * Para cada um: prints (desktop 1366 e celular 390) em docs/dashboard-54/<rotulo>/ e o retrato dos valores
 * (R$, %, números soltos e células de tabela, fora dos eixos dos gráficos) em valores-<rotulo>.json, além do
 * contraste de todo texto da área. Loja local dash54-loja (scripts/dashboard/semear-54.mjs). Não grava nada.
 *
 *   node scripts/dashboard/capturas-54.mjs antes|depois [slug-login]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const ROTULO = process.argv[2] ?? 'depois'
const LOGIN = process.argv[3] ?? 'dono.dash54'
const PASTA = join('docs', 'dashboard-54', ROTULO)
mkdirSync(PASTA, { recursive: true })
exigirLoopback(chavesLocais().DB_URL, BASE)

const browser = await chromium.launch()
async function logar(opcoes) {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', LOGIN); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}

/** Valores do trecho (elementos) — sem o texto de dentro dos gráficos (eixos e tooltips mudam com o desenho). */
const coletar = (p, seletor) => p.evaluate((seletor) => {
  const raizes = seletor === 'antes'
    ? (() => { const h = [...document.querySelectorAll('h3')].find((e) => e.textContent.trim() === 'Análise de pedidos'); if (!h) return []; const sec = h.closest('section'); const out = [sec]; let n = sec.nextElementSibling; while (n) { out.push(n); n = n.nextElementSibling } return out })()
    : [...document.querySelectorAll(seletor)]
  const tokens = { dinheiro: [], pct: [], numeros: [], celulas: [] }
  for (const raiz of raizes) {
    const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
    for (let n = andar.nextNode(); n; n = andar.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest('svg, [data-testid$="-tooltip"], [role="tooltip"]')) continue
      const r = el.getBoundingClientRect(); if (!r.width && !r.height && !el.closest('table')) continue
      const t = n.textContent.replace(/\s+/g, ' ').trim()
      if (!t) continue
      for (const m of t.matchAll(/R\$\s?-?[\d.]+,\d{2}/g)) tokens.dinheiro.push(m[0].replace(/\s/g, ''))
      for (const m of t.matchAll(/-?\d+(?:,\d+)?%/g)) tokens.pct.push(m[0])
      if (/^\d[\d.]*$/.test(t)) tokens.numeros.push(t)
      if (el.closest('td')) tokens.celulas.push(t)
    }
  }
  for (const k of Object.keys(tokens)) tokens[k].sort()
  return tokens
}, seletor)

const contraste = (p, seletor) => p.evaluate((seletor) => {
  const raiz = document.querySelector(seletor) ?? document.querySelector('main') ?? document.body
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { c: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 } }
  const fundo = (el) => { for (let e = el; e; e = e.parentElement) { const b = rgb(getComputedStyle(e).backgroundColor); if (b && b.a >= 1) return b.c } return [255, 255, 255] }
  const falhas = []; let total = 0; const vistos = new Set()
  const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const el = n.parentElement
    if (!el || vistos.has(el) || !n.textContent.trim() || el.closest('svg, [aria-hidden="true"], button:disabled, input, select, textarea, .gm-style')) continue
    vistos.add(el)
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    if (!r.width || !r.height || cs.visibility === 'hidden') continue
    const fg = rgb(cs.color); if (!fg) continue
    const bg = fundo(el); const cor = fg.c.map((x, i) => x * fg.a + bg[i] * (1 - fg.a))
    const [l1, l2] = [lum(cor), lum(bg)].sort((a, b) => b - a); const razao = (l1 + 0.05) / (l2 + 0.05)
    const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
    total++
    if (razao < (grande ? 3 : 4.5)) falhas.push({ texto: n.textContent.trim().slice(0, 40), razao: Math.round(razao * 100) / 100, cor: cs.color, px: cs.fontSize })
  }
  return { total, falhas }
}, seletor)

/** O painel rola por dentro (contêiner com overflow): solta a altura dele para o print de página inteira pegar tudo. */
const soltarRolagem = (p) => p.evaluate(() => {
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('.gm-style, [data-testid="mapa-pedidos"]')) continue // o mapa mede a própria caixa
    const cs = getComputedStyle(el)
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) {
      el.style.overflowY = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { a.style.height = 'auto'; a.style.maxHeight = 'none'; a.style.overflow = 'visible' }
    }
  }
})

const rel = { rotulo: ROTULO, login: LOGIN, telas: {} }
try {
  for (const [disp, opcoes] of [['desktop', { viewport: { width: 1366, height: 860 } }], ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Pixel 7'].userAgent }]]) {
    const { ctx, p } = await logar(opcoes)
    await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(4000)
    if (ROTULO === 'antes') {
      const h = p.locator('h3', { hasText: 'Análise de pedidos' }).first()
      await h.scrollIntoViewIfNeeded().catch(() => {})
      rel.telas[`analises@${disp}`] = { valores: await coletar(p, 'antes'), contraste: await contraste(p, 'main') }
      await soltarRolagem(p); await p.waitForTimeout(1500)
      await p.screenshot({ path: join(PASTA, `dashboard-${disp}.png`), fullPage: true })
    } else {
      const bloco = p.getByTestId('dash-analises')
      await bloco.scrollIntoViewIfNeeded().catch(() => {})
      const abas = await p.locator('[data-testid^="dash-aba-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
      const todos = { dinheiro: [], pct: [], numeros: [], celulas: [] }
      for (const aba of abas) {
        await p.getByTestId(aba).click()
        await p.waitForTimeout(aba === 'dash-aba-bairros' ? 3500 : 900)
        const ver = p.getByTestId('cliques-ver-todos')
        if (await ver.isVisible().catch(() => false)) { await ver.click(); await p.waitForTimeout(300) }
        const v = await coletar(p, '[data-testid="dash-analises-painel"]')
        for (const k of Object.keys(todos)) todos[k].push(...v[k])
        rel.telas[`${aba}@${disp}`] = { contraste: await contraste(p, '[data-testid="dash-analises"]') }
        await soltarRolagem(p); await p.waitForTimeout(400)
        await bloco.screenshot({ path: join(PASTA, `${aba.replace('dash-aba-', '')}-${disp}.png`) })
      }
      for (const k of Object.keys(todos)) todos[k].sort()
      rel.telas[`analises@${disp}`] = { valores: todos }
      await p.getByTestId('dash-aba-pedidos').click(); await p.waitForTimeout(900)
      await soltarRolagem(p); await p.waitForTimeout(1500)
      await p.screenshot({ path: join(PASTA, `dashboard-${disp}.png`), fullPage: true })
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(PASTA, `valores-${ROTULO}.json`), JSON.stringify(rel, null, 1))
const falhas = Object.entries(rel.telas).flatMap(([t, r]) => (r.contraste?.falhas ?? []).map((f) => ({ t, ...f })))
console.log(`capturas ${ROTULO}: ${Object.keys(rel.telas).length} · abaixo do contraste: ${falhas.length}`)
for (const f of falhas.slice(0, 25)) console.log(`   ${f.t}: "${f.texto}" ${f.razao}:1 (${f.cor}, ${f.px})`)
