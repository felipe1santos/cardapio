/**
 * Prints antes/depois dos ajustes visuais de 2026-10-06 (Impressão, Dashboard, Ajustes, vitrine).
 *   node scripts/revisao-ajustes/capturas.mjs antes|depois
 * Servidor local (127.0.0.1:3999) e banco local. Lojas: dash54-loja (painel, dono.dash54), p8-longa
 * (vitrine nova, chave ligada só durante o teste e devolvida no fim) e ordem-qr-e2e (vitrine clássica).
 * Saída: C:\Users\felipe\Downloads\revisao-ajustes\<rotulo>\ + contraste.json (textos abaixo de 4,5:1).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const ROTULO = process.argv[2] ?? 'depois'
const PASTA = join(homedir(), 'Downloads', 'revisao-ajustes', ROTULO)
mkdirSync(PASTA, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (sql, args) => (await db.query(sql, args)).rows[0]

const browser = await chromium.launch()
const contraste = {}
const shot = (p, nome, opts = {}) => p.screenshot({ path: join(PASTA, `${nome}.png`), ...opts })
const shotEl = async (loc, nome) => { await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.screenshot({ path: join(PASTA, `${nome}.png`) }).catch((e) => console.log('sem print', nome, e.message.split('\n')[0])) }

/** Textos visíveis abaixo de 4,5:1 (3:1 para texto grande) dentro do seletor. */
const auditar = (p, seletor) => p.evaluate((seletor) => {
  const raiz = document.querySelector(seletor) ?? document.body
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number)
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const fundo = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c } return [255, 255, 255] }
  const ruins = []
  const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const el = n.parentElement; const t = n.textContent.trim()
    if (!el || !t || el.closest('svg')) continue
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) continue
    const a = lum(rgb(cs.color)), b = lum(fundo(el)); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
    if (cr < (grande ? 3 : 4.5)) ruins.push({ t: t.slice(0, 50), cr: Math.round(cr * 100) / 100, cor: cs.color, fundo: fundo(el).join(',') })
  }
  return ruins
}, seletor)

async function logar(opcoes, login = 'dono.dash54') {
  const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
async function fecharAvisos(p) {
  for (const t of ['OK, entendi', 'Agora não', 'Depois', 'Fechar']) await p.getByRole('button', { name: t }).first().click({ timeout: 600 }).catch(() => {})
}

const lojaNova = await um(`select id, vitrine_nova vn, frete_gratis_acima fg from restaurantes where slug='p8-longa'`)
// A loja do painel (dash54-loja) com a chave da vitrine nova, para Ajustes mostrar tamanho e fonte. Volta no fim.
const lojaPainel = await um(`select id, vitrine_nova vn from restaurantes where slug='dash54-loja'`)
await db.query(`update restaurantes set vitrine_nova=true where id=$1`, [lojaPainel.id])
try {
  for (const [disp, opcoes] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['celular', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }]]) {
    const { ctx, p } = await logar(opcoes)
    // ── 1. Impressão
    await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' }); await fecharAvisos(p); await p.waitForTimeout(800)
    await shot(p, `impressao-${disp}`)
    await shotEl(p.getByTestId('passo-1'), `impressao-passo1-${disp}`)
    contraste[`impressao-${disp}`] = await auditar(p, '[data-testid="painel-impressao"]')

    // ── 2. Dashboard
    await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' }); await fecharAvisos(p); await p.waitForTimeout(1200)
    await shot(p, `dashboard-${disp}`)
    const rosca = p.getByTestId('origem-rosca')
    if (await rosca.count()) {
      await rosca.scrollIntoViewIfNeeded()
      // a fatia mais à direita (perto da borda do card/tela)
      const fatias = rosca.locator('path[data-fatia]')
      let alvo = null, maxX = -1
      for (let i = 0; i < await fatias.count(); i++) { const b = await fatias.nth(i).boundingBox(); if (b && b.x + b.width > maxX) { maxX = b.x + b.width; alvo = fatias.nth(i) } }
      if (alvo) {
        const b = await alvo.boundingBox()
        if (disp === 'desktop') await p.mouse.move(b.x + b.width - 6, b.y + b.height / 2); else await p.touchscreen.tap(b.x + b.width - 6, b.y + b.height / 2)
        await p.waitForTimeout(400)
        await shot(p, `dashboard-tooltip-pizza-${disp}`)
        const tip = p.getByTestId('origem-rosca-tooltip')
        const bt = await tip.boundingBox().catch(() => null)
        const vw = p.viewportSize().width
        contraste[`tooltip-pizza-${disp}`] = bt ? { dentroDaTela: bt.x >= 0 && bt.x + bt.width <= vw, z: await tip.evaluate((e) => getComputedStyle(e).zIndex), noBody: await tip.evaluate((e) => e.parentElement === document.body || !!e.closest('[data-flutuante-portal]')) } : 'sem tooltip'
        await p.mouse.move(700, 120); await p.keyboard.press('Escape')
      }
    }
    const graf = p.locator('[data-testid="dash54-grafico-pedidos"]:visible').first()
    if (await graf.count()) {
      await shotEl(graf, `dashboard-analise-pedidos-${disp}`)
      // tooltip do gráfico de barras perto da borda direita
      const bb = await graf.locator('svg').first().boundingBox({ timeout: 4000 }).catch(() => null)
      if (bb && disp === 'desktop') { await p.mouse.move(bb.x + bb.width - 8, bb.y + bb.height / 2); await p.waitForTimeout(300); await shot(p, `dashboard-tooltip-barras-${disp}`); await p.mouse.move(2, 2) }
    }
    const abaCliques = p.getByTestId('dash-aba-cliques')
    contraste[`dashboard-aba-cliques-${disp}`] = (await abaCliques.count()) ? 'existe' : 'removida'
    if (await abaCliques.count()) { await abaCliques.click(); await p.waitForTimeout(500); await shotEl(p.getByTestId('dash-analises'), `dashboard-cliques-${disp}`) }
    contraste[`dashboard-${disp}`] = await auditar(p, 'main')

    // ── 3. Ajustes
    await p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' }); await fecharAvisos(p); await p.waitForTimeout(1200)
    await shot(p, `ajustes-${disp}`)
    const nav = p.locator('nav[aria-label="Seções dos ajustes"]')
    const nomes = await nav.locator('button').allInnerTexts()
    for (const nome of nomes) {
      const slug = nome.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')
      await nav.locator('button', { hasText: nome.trim() }).first().click(); await p.waitForTimeout(700)
      await shot(p, `ajustes-${slug}-${disp}`, { fullPage: false })
      if (disp === 'desktop') {
        // página inteira da seção (rolando o conteúdo)
        const rol = p.locator('[data-ajustes-rolagem]:visible, .overflow-y-auto:visible').last()
        const alt = await rol.evaluate((e) => e.scrollHeight).catch(() => 0)
        if (alt > 900) for (let y = 800, k = 2; y < alt; y += 800, k++) { await rol.evaluate((e, y) => { e.scrollTop = y }, y); await p.waitForTimeout(250); await shot(p, `ajustes-${slug}-${disp}-${k}`) }
      }
    }
    await nav.locator('button').first().click(); await p.waitForTimeout(600)
    for (const [tid, nome] of [['imagem-tamanho', 'ajustes-tamanho-imagem'], ['previa-linha-item', 'ajustes-previa-vitrine'], ['editor-aviso', 'ajustes-cores-aviso'],
      ['secao-dados', 'ajustes-bloco-1-dados'], ['secao-logo', 'ajustes-bloco-2-logo'], ['secao-capa', 'ajustes-bloco-3-capa'], ['secao-promo', 'ajustes-bloco-3-promo'],
      ['secao-endereco', 'ajustes-bloco-4-endereco'], ['secao-horario', 'ajustes-bloco-5-horario'], ['secao-aparencia', 'ajustes-bloco-6-aparencia']]) {
      const el = p.locator(`[data-testid="${tid}"]:visible`).first()
      if (await el.count()) await shotEl(el, `${nome}-${disp}`)
    }
    contraste[`ajustes-${disp}`] = await auditar(p, 'main')
    await ctx.close()
  }

  // ── 4/5. Vitrine nova (p8-longa com a chave) e clássica, 390 px
  await db.query(`update restaurantes set vitrine_nova=true, frete_gratis_acima=500 where id=$1`, [lojaNova.id])
  for (const [slug, nome] of [['p8-longa', 'vitrine-nova'], ['ordem-qr-e2e', 'vitrine-classica']]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'networkidle' })
    await p.getByText('Continuar no cardápio').first().tap({ timeout: 3000 }).catch(() => {})
    await p.waitForTimeout(500)
    const selo = p.locator('[data-desconto]').first()
    if (await selo.count()) {
      await selo.scrollIntoViewIfNeeded(); await p.waitForTimeout(300)
      await shot(p, `${nome}-tags-desconto-390`)
      await shotEl(selo, `${nome}-selo-desconto-zoom`)
      contraste[`${nome}-selo`] = await selo.evaluate((e) => ({ fundo: getComputedStyle(e).backgroundColor, cor: getComputedStyle(e).color, svg: e.querySelectorAll('svg').length, raio: getComputedStyle(e).borderRadius, fonte: getComputedStyle(e).fontSize + '/' + getComputedStyle(e).fontWeight }))
    }
    if (slug === 'p8-longa') {
      await p.locator('button[data-item-id]').first().tap(); await p.waitForTimeout(600)
      await p.getByRole('button', { name: /Adicionar/ }).last().tap().catch(() => {}); await p.waitForTimeout(600)
      await p.getByText('Ver sacola').first().tap().catch(() => {}); await p.waitForTimeout(900)
      const card = p.getByTestId('frete-gratis')
      await shot(p, `${nome}-sacola-entrega-gratis-390`)
      if (await card.count()) { await shotEl(card, `${nome}-card-entrega-gratis-zoom`); contraste['card-entrega-gratis'] = await auditar(p, '[data-testid="frete-gratis"]') }
      else {
        const txt = p.getByText(/para a entrega grátis/).first()
        if (await txt.count()) await shotEl(txt.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), `${nome}-card-entrega-gratis-zoom`)
      }
      // atingiu: meta baixa
      await db.query(`update restaurantes set frete_gratis_acima=1 where id=$1`, [lojaNova.id])
      await p.reload({ waitUntil: 'networkidle' }); await p.getByText('Continuar no cardápio').first().tap({ timeout: 2000 }).catch(() => {})
      await p.getByText('Ver sacola').first().tap().catch(() => {}); await p.waitForTimeout(900)
      await shot(p, `${nome}-sacola-entrega-gratis-atingida-390`)
    }
    await ctx.close()
  }
} finally {
  await db.query(`update restaurantes set vitrine_nova=$2, frete_gratis_acima=$3 where id=$1`, [lojaNova.id, lojaNova.vn, lojaNova.fg])
  await db.query(`update restaurantes set vitrine_nova=$2 where id=$1`, [lojaPainel.id, lojaPainel.vn])
  await browser.close(); await db.end()
  writeFileSync(join(PASTA, 'contraste.json'), JSON.stringify(contraste, null, 1))
  console.log('prints em', PASTA)
  console.log(JSON.stringify(Object.fromEntries(Object.entries(contraste).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} abaixo` : v])), null, 1))
}
