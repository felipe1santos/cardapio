/**
 * Tira screenshots da vitrine num viewport de celular.
 *
 * Rodar contra o servidor local (`npm run start`) enquanto se mexe no visual:
 *   node scripts/shots-vitrine.mjs http://localhost:3003 estancia-burger
 *
 * As imagens saem em .shots/ (fora do git) — é ferramenta de conferência, não
 * teste automatizado: quem olha e decide se ficou bom é gente.
 */
import { chromium, devices } from 'playwright'
import fs from 'fs'

const base = process.argv[2] ?? 'http://localhost:3003'
const slug = process.argv[3] ?? 'estancia-burger'
const dir = '.shots'

fs.mkdirSync(dir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR' })
const page = await context.newPage()

const shot = async (nome) => {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${dir}/${slug}-${nome}.png` })
  console.log('•', `${slug}-${nome}`)
}

await page.goto(`${base}/loja/${slug}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// Modal de prêmio (loja com cupom público ou prêmio de fidelidade ativo).
if (await page.locator('text=Ver meus prêmios').count()) {
  await shot('01-premio-boas-vindas')
  await page.locator('text=Continuar no cardápio').first().click()
  await page.waitForTimeout(400)
}

await shot('02-home')

// Sobre a loja.
await page.locator('[aria-label="Informações da loja"]').click()
await shot('03-info-loja')
await page.locator('text=×').first().click()
await page.waitForTimeout(400)

// Ficha do produto → adiciona ao carrinho.
await page.locator('button:has-text("R$")').first().click()
await page.waitForTimeout(700)
await shot('04-produto')
await page.locator('button:has-text("Adicionar")').last().click()
await page.waitForTimeout(400)
await shot('05-toast-adicionado')

// Carrinho: linhas, "Peça também" e o toast do clique rápido.
await page.locator('text=Ver sacola').first().click()
await page.waitForTimeout(800)
await shot('06-carrinho')

const bump = page.locator('text=+ Adicionar').first()
if (await bump.count()) {
  await bump.click()
  await page.waitForTimeout(300)
  await shot('07-carrinho-toast-bump')
}

// Calcular frete (agora modal centralizado).
await page.goto(`${base}/loja/${slug}`, { waitUntil: 'networkidle' })
await page.locator('text=Ver sacola').first().click()
await page.waitForTimeout(600)
const calcular = page.locator('text=Calcular taxa de entrega').first()
if (await calcular.count()) {
  await calcular.click()
  await shot('08-frete-modal')
}

await browser.close()
console.log('\nimagens em', dir)
