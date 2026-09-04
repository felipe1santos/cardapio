/**
 * Confere "Pedir de novo" e a faixa de pedido em andamento com um cliente real.
 *
 *   node scripts/shots-recompra.mjs http://localhost:3011 menuzia 5527992534407
 *
 * Lê o token de sessão do cliente direto do banco (service role) e injeta no
 * localStorage — é a única forma de exercitar as telas que exigem login sem
 * disparar OTP de verdade. Nada é gravado: o script só lê.
 */
import { chromium, devices } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const base = process.argv[2] ?? 'http://localhost:3011'
const slug = process.argv[3] ?? 'menuzia'
const telefone = process.argv[4]
const dir = '.shots'
fs.mkdirSync(dir, { recursive: true })

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const supa = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: loja } = await supa.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
const { data: cliente } = await supa
  .from('clientes')
  .select('telefone, token')
  .eq('restaurante_id', loja.id)
  .eq('telefone', telefone)
  .maybeSingle()

if (!cliente?.token) {
  console.log('cliente sem sessão salva — rode o login uma vez na vitrine')
  process.exit(0)
}

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR' })
await context.addInitScript(
  ([chave, valor]) => window.localStorage.setItem(chave, valor),
  [`menuzia_cliente_${slug}`, JSON.stringify({ telefone: cliente.telefone, token: cliente.token })]
)
const page = await context.newPage()
const shot = async (nome) => {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${dir}/${slug}-recompra-${nome}.png` })
  console.log('•', `${slug}-recompra-${nome}`)
}

await page.goto(`${base}/loja/${slug}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
for (const fechar of ['Continuar no cardápio', 'Agora não']) {
  if (await page.locator(`text=${fechar}`).count()) await page.locator(`text=${fechar}`).first().click()
}

// Faixa de pedido em andamento (só aparece com pedido não finalizado).
console.log('  faixa de pedido em andamento:', await page.locator('text=/Pedido #\\d+ ·/').count())
await shot('01-home')

// Histórico → "Pedir de novo".
await page.locator('nav button', { hasText: 'Pedidos' }).last().click()
await page.waitForTimeout(1500)
await shot('02-historico')
const repetir = page.locator('text=Pedir de novo')
console.log('  botões "Pedir de novo":', await repetir.count())
if (await repetir.count()) {
  await repetir.first().click()
  await page.waitForTimeout(1200)
  await shot('03-sacola-repetida')
}

await browser.close()
console.log('\nimagens em', dir)
