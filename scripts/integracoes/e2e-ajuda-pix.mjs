/**
 * Ajuda do Pix online no card do Mercado Pago (2026-10-08).
 *   · "i" no canto do card de Integrações e no cabeçalho da janela do Mercado Pago; dica "Como funciona";
 *     cinza parado, azul no hover; não cobre o "Conectar".
 *   · janela central: abre e fecha (✕, Esc, clique fora); Esc na ajuda aberta por cima da janela do
 *     Mercado Pago fecha SÓ a ajuda.
 *   · texto para o lojista: sem termos técnicos; as 4 partes e "Falar com o suporte" (WhatsApp da Menuzia).
 *   · peso de fonte ≤ 600; contraste ≥ 4,5:1; celular 360 e 390 px sem rolagem lateral.
 * Banco e servidor LOCAIS (dash54-loja / dono.dash54). Prints em Downloads\revisao-ajuda-pix.
 *   node scripts/integracoes/e2e-ajuda-pix.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const PRINTS = join(homedir(), 'Downloads', 'revisao-ajuda-pix'); mkdirSync(PRINTS, { recursive: true })
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (q, a) => (await db.query(q, a)).rows[0]
let falhas = 0, total = 0
const ok = (m, c, d = '') => { total++; console.log(`${c ? '✓' : '✗'} ${m}${c ? '' : ' — ' + d}`); if (!c) falhas++ }
const secao = (t) => console.log(`\n── ${t}`)

const loja = await um(`select id, pix_online_ativo pix from restaurantes where slug='dash54-loja'`)
await db.query('update restaurantes set pix_online_ativo = true where id = $1', [loja.id])
const browser = await chromium.launch()
async function logar(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.dash54'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'networkidle' })
  for (const t of ['OK, entendi', 'Agora não', 'Depois']) await p.getByRole('button', { name: t }).first().click({ timeout: 500 }).catch(() => {})
  await p.getByTestId('integracao-mercadopago').waitFor({ timeout: 15000 })
  return { ctx, p }
}
const TECNICOS = /webhook|token|vari[aá]vel|coolify|\.tsx?\b|\.md\b|api\b|oauth|servidor|env\b|supabase|json/i
const janela = (p) => p.getByTestId('ajuda-mercadopago-janela')
// Contraste WCAG de cada texto da janela contra o fundo branco dela.
const contrasteMinimo = (p) => p.evaluate(() => {
  const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const fundo = (el) => { while (el) { const b = getComputedStyle(el).backgroundColor; if (b && !b.endsWith(', 0)') && b !== 'transparent') return b; el = el.parentElement } return 'rgb(255,255,255)' }
  let pior = 99, qual = ''
  for (const el of document.querySelectorAll('[data-testid="ajuda-mercadopago-janela"] *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    const a = lum(getComputedStyle(el).color), b = lum(fundo(el))
    const r = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    if (r < pior) { pior = r; qual = el.textContent.trim().slice(0, 40) }
  }
  return { pior: Math.round(pior * 100) / 100, qual }
})

try {
  secao('desktop 1366')
  {
    const { ctx, p } = await logar({ width: 1366, height: 860 })
    const i = p.getByTestId('ajuda-mercadopago').first()
    ok('"i" no card do Mercado Pago', await i.isVisible())
    const cor = await i.evaluate((e) => getComputedStyle(e).color)
    await i.hover(); await p.waitForTimeout(400)
    const corHover = await i.evaluate((e) => getComputedStyle(e).color)
    ok('cinza parado, azul no hover', cor === 'rgb(156, 163, 175)' && corHover === 'rgb(6, 136, 212)', `${cor} → ${corHover}`)
    ok('dica "Como funciona"', await p.getByText('Como funciona', { exact: true }).first().isVisible().catch(() => false))
    const bi = await i.boundingBox(), bc = await p.getByTestId('integracao-mercadopago').boundingBox()
    ok('"i" no canto do card, dentro dele', bi.x + bi.width <= bc.x + bc.width && bi.y >= bc.y && bi.y + bi.height <= bc.y + bc.height / 2 + 4, JSON.stringify({ bi, bc }))
    await i.click(); await janela(p).waitFor({ timeout: 5000 })
    ok('abre a janela central', await janela(p).isVisible())
    ok('clicar no "i" não abre a configuração do Mercado Pago junto', (await p.getByTestId('janela-integracao').count()) === 0)
    const texto = await p.getByTestId('ajuda-mercadopago-texto').innerText()
    ok('as quatro partes', ['O que é', 'Quanto custa', 'Passo a passo', 'Perguntas comuns'].every((t) => texto.includes(t)), texto.slice(0, 200))
    ok('passo a passo: conta grátis → chave Pix (CNPJ) → Conectar → Pagar agora', /conta grátis/.test(texto) && /chave Pix/.test(texto) && /CNPJ/.test(texto) && /Conectar Mercado Pago/.test(texto) && /Pagar agora/.test(texto))
    ok('perguntas: não pagou, pagou depois, devolver com PIN, desligar', /cancelado sozinho/.test(texto) && /a devolver/.test(texto) && /PIN/.test(texto) && /Desconectar/.test(texto))
    ok('sem termos técnicos', !TECNICOS.test(texto), texto.match(TECNICOS)?.[0])
    const href = await p.getByTestId('ajuda-mercadopago-suporte').getAttribute('href')
    ok('"Falar com o suporte" abre o WhatsApp da Menuzia', href.startsWith('https://wa.me/5527992534407?text='), href)
    const peso = await p.evaluate(() => Math.max(...[...document.querySelectorAll('[data-testid="ajuda-mercadopago-janela"] *')].map((e) => Number(getComputedStyle(e).fontWeight))))
    ok('peso de fonte ≤ 600', peso <= 600, String(peso))
    const c = await contrasteMinimo(p)
    ok('contraste ≥ 4,5:1 em todos os textos', c.pior >= 4.5, JSON.stringify(c))
    await p.screenshot({ path: join(PRINTS, '01-ajuda-1366.png') })
    await p.getByTestId('ajuda-mercadopago-janela-fechar').click(); await p.waitForTimeout(300)
    ok('fecha no ✕', (await janela(p).count()) === 0)
    await i.click(); await janela(p).waitFor(); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    ok('fecha no Esc', (await janela(p).count()) === 0)
    await i.click(); await janela(p).waitFor(); await p.mouse.click(8, 8); await p.waitForTimeout(300)
    ok('fecha no clique fora', (await janela(p).count()) === 0)

    // Dentro da janela do Mercado Pago: "i" no cabeçalho do card, sem cobrir o "Conectar".
    await p.getByTestId('integracao-mercadopago').click()
    await p.getByTestId('cartao-mercadopago').waitFor({ timeout: 8000 })
    const iCard = p.getByTestId('cartao-mercadopago').getByTestId('ajuda-mercadopago')
    ok('"i" também no card dentro da janela', await iCard.isVisible())
    const conectar = p.getByTestId('mp-conectar')
    if (await conectar.count()) {
      const a = await iCard.boundingBox(), b = await conectar.boundingBox()
      ok('"i" não encosta no "Conectar"', a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x)
    }
    await iCard.click(); await janela(p).waitFor()
    await p.screenshot({ path: join(PRINTS, '02-ajuda-sobre-janela-1366.png') })
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    ok('Esc fecha só a ajuda; a janela do Mercado Pago continua', (await janela(p).count()) === 0 && await p.getByTestId('janela-integracao').isVisible())
    await ctx.close()
  }

  for (const largura of [360, 390]) {
    secao(`celular ${largura}`)
    const { ctx, p } = await logar({ width: largura, height: 780 })
    await p.getByTestId('ajuda-mercadopago').first().click(); await janela(p).waitFor()
    const caixa = await janela(p).boundingBox()
    ok('janela cabe na tela', caixa.x >= 0 && caixa.x + caixa.width <= largura, JSON.stringify(caixa))
    ok('sem rolagem lateral', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const sup = await p.getByTestId('ajuda-mercadopago-suporte').boundingBox()
    ok('"Falar com o suporte" visível e com altura de toque', sup && sup.height >= 44 && sup.y + sup.height <= 780, JSON.stringify(sup))
    const toque = await p.getByTestId('ajuda-mercadopago-janela-fechar').boundingBox()
    ok('✕ com área de toque ≥ 32 px', toque.width >= 32 && toque.height >= 32)
    await p.screenshot({ path: join(PRINTS, `03-ajuda-${largura}.png`) })
    await ctx.close()
  }
} finally {
  await db.query('update restaurantes set pix_online_ativo = $2 where id = $1', [loja.id, loja.pix])
  await browser.close(); await db.end()
  console.log(`\n${total - falhas}/${total} ok`)
  process.exitCode = falhas ? 1 : 0
}
