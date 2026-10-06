/**
 * Prints da vitrine (pendência 9): home, ficha, sacola e cada etapa do checkout, no celular
 * (390) e no desktop (1366). Servidor LOCAL, loja local sem WhatsApp (telefone pelo fallback).
 * Não grava pedido: para antes de "Fazer pedido".
 *
 *   node scripts/vitrine-p9/shots.mjs <antes|depois> [slug] [pasta]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from 'playwright'

const ROT = process.argv[2] ?? 'depois'
const SLUG = process.argv[3] ?? 'p8-longa'
const DIR = process.argv[4] ?? 'docs/vitrine-p9'
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) throw new Error('só servidor local')
mkdirSync(DIR, { recursive: true })

const browser = await chromium.launch()
const SO = process.env.SO
for (const [nome, opts] of [
  ['390', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
  ['1366', { viewport: { width: 1366, height: 900 } }],
].filter(([n]) => !SO || n === SO)) {
  const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' })
  const p = await ctx.newPage()
  const shot = async (etapa, cheia = false) => {
    await p.waitForTimeout(700)
    await p.screenshot({ path: join(DIR, `${ROT}-${nome}-${etapa}.png`), fullPage: cheia })
    console.log('•', `${ROT}-${nome}-${etapa}`)
  }
  const toque = (loc) => (nome === '390' ? loc.tap() : loc.click())
  // Só botão visível: o checkout fechado continua no DOM com os botões dele.
  const visivel = (re) => p.locator('button:visible').filter({ hasText: re }).last()
  try {
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => localStorage.clear())
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(1200)
    if (await p.getByText('Continuar no cardápio').count()) await toque(p.getByText('Continuar no cardápio').first())
    await shot('01-home')
    await p.mouse.wheel(0, 700)
    await shot('02-lista')
    // Item com promoção, se houver; senão o primeiro.
    const comPromo = p.locator('button[data-item-id]').filter({ has: p.locator('s, del, .line-through') }).first()
    const item = (await comPromo.count()) ? comPromo : p.locator('button[data-item-id]').first()
    await toque(item)
    await p.waitForTimeout(800)
    await shot('03-ficha')
    const req = p.locator('[role="dialog"] input[type="radio"], [role="dialog"] [role="radio"]')
    if (await req.count()) await req.first().check({ force: true }).catch(() => {})
    await toque(p.getByRole('button', { name: /Adicionar/ }).last())
    await p.waitForTimeout(700)
    // No desktop a sacola já fica aberta à direita.
    const ver = p.getByText(/Ver sacola/).first()
    if (nome === '390') await toque(ver)
    await p.waitForTimeout(900)
    await shot('04-sacola')
    await shot('04-sacola-inteira', true)
    await toque(nome === '390' ? p.locator('[data-testid="barra-sacola-continuar"] button') : p.locator('aside button').filter({ hasText: /Continuar/ }))
    await p.waitForTimeout(800)
    const tel = p.getByPlaceholder('(00) 00000-0000').first()
    if (await tel.count()) {
      await shot('05-telefone')
      await tel.fill('27999880077')
      await toque(p.locator('[data-testid="janela-conta"] button').filter({ hasText: /^Continuar$/i }))
      await p.waitForTimeout(1500)
    }
    await shot('06-etapa-1')
    for (let i = 2; i <= 4; i++) {
      const nomeInput = p.getByPlaceholder('Seu nome')
      if (await nomeInput.count() && (await nomeInput.inputValue()) === '') await nomeInput.fill('Cliente Print')
      const bairro = p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first()
      if (await bairro.count() && (await bairro.inputValue()) === '') {
        await bairro.fill('Centro')
        await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
        await p.getByPlaceholder('123').fill('10')
        await p.waitForTimeout(1000)
      }
      const pix = p.getByText(/^Pix/).first()
      if (await pix.count()) await toque(pix).catch(() => {})
      const prox = p.locator('[data-barra-checkout] button').filter({ hasText: /Ir para|Revisar pedido|Continuar|Fazer pedido/ }).last()
      if (!(await prox.count())) break
      await toque(prox)
      await p.waitForTimeout(1000)
      await shot(`06-etapa-${i}`)
      if (await p.locator('[data-testid="revise-pedido"], button:has-text("Fazer pedido"):visible').count()) break
    }
  } catch (e) {
    console.log('  ⚠', nome, String(e).slice(0, 200))
    await shot('ERRO').catch(() => {})
  }
  await ctx.close()
}
await browser.close()
