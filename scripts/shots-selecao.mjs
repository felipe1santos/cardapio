/**
 * Confere o feedback de seleção dentro da ficha do produto e os estados vazios
 * das abas — as telas que o script principal não cobre porque exigem interação.
 *
 *   node scripts/shots-selecao.mjs http://localhost:3009 estancia-burger
 *
 * Precisa do playwright instalado sob demanda (ver scripts/shots-vitrine.mjs).
 */
import { chromium, devices } from 'playwright'
import fs from 'fs'

const base = process.argv[2] ?? 'http://localhost:3009'
const slug = process.argv[3] ?? 'estancia-burger'
const dir = '.shots'
fs.mkdirSync(dir, { recursive: true })

const browser = await chromium.launch()
const page = await (await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR' })).newPage()
const shot = async (nome) => {
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/${slug}-sel-${nome}.png` })
  console.log('•', `${slug}-sel-${nome}`)
}

await page.goto(`${base}/loja/${slug}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
if (await page.locator('text=Continuar no cardápio').count()) {
  await page.locator('text=Continuar no cardápio').first().click()
  await page.waitForTimeout(400)
}

// Ficha do produto: antes e depois de escolher a opção obrigatória.
await page.locator('button:has-text("R$")').first().click()
await page.waitForTimeout(800)
await shot('01-antes')

const obrigatorio = page.locator('text=OBRIGATÓRIO')
console.log('  etiqueta obrigatório antes:', await obrigatorio.count())

// Clica na primeira opção do primeiro grupo.
await page.locator('.overflow-y-auto button').filter({ hasText: 'R$' }).nth(1).click().catch(async () => {
  await page.locator('button', { hasText: 'R$' }).nth(2).click()
})
await page.waitForTimeout(600)
await shot('02-depois')
console.log('  etiqueta obrigatório depois:', await page.locator('text=OBRIGATÓRIO').count())

// Marca um adicional (grupo opcional com stepper ou checkbox).
const mais = page.locator('button:has-text("+")').last()
if (await mais.count()) {
  await mais.click()
  await page.waitForTimeout(500)
  await shot('03-adicional')
}

await page.keyboard.press('Escape').catch(() => {})

// Abas vazias.
await page.goto(`${base}/loja/${slug}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
await page.locator('text=Pedidos').last().click()
await shot('04-pedidos-vazio')
await page.locator('text=Cupons').last().click()
await page.waitForTimeout(900)
await shot('05-cupons')

await browser.close()
console.log('\nimagens em', dir)
