/**
 * "Mesas e Comandas" no menu lateral, por papel e por flag — pela tela, no navegador.
 *
 * Confere: item no menu principal (desktop e gaveta do celular) logo após o PDV para
 * dono, garçom e caixa com o módulo ligado; ausente com o módulo desligado (menu, rota e
 * API barrados); e Ajustes › Mesas só com configuração (sem atalho operacional nem
 * cadastro de mesas) quando o módulo está ligado. Só loopback.
 *
 *   node scripts/seguranca/verificar-menu-mesas.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { E2E_LOJA, USU, exigirLojaIsolada } from './e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
exigirLojaIsolada() // a semente apaga os dados da loja semeada
execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })
mkdirSync('.shots', { recursive: true })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id from restaurantes where slug='${E2E_LOJA}'`)).rows[0].id
const browser = await chromium.launch()

async function logar(usuario, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'pt-BR', isMobile: viewport.width < 800, hasTouch: viewport.width < 800 })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
  await page.waitForLoadState('networkidle').catch(() => {})
  return { ctx, page }
}

async function menu(page) {
  // No celular a barra lateral é gaveta: abre pelo botão do topo.
  const abrir = page.getByRole('button', { name: /abrir o menu/i })
  if (await abrir.count()) {
    await abrir.first().click()
    await page.waitForTimeout(400)
  }
  await page.waitForTimeout(1500)
  return (await page.locator('aside').first().innerText()).split('\n').map((l) => l.trim()).filter(Boolean)
}

const DESKTOP = { width: 1360, height: 900 }
const CELULAR = { width: 390, height: 844 }

console.log('\n── módulo ligado ──')
for (const [usuario, tela] of [[USU.dono, DESKTOP], [USU.dono, CELULAR], [USU.garcom, CELULAR], [USU.atendente, DESKTOP]]) {
  const { ctx, page } = await logar(usuario, tela)
  await page.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }).catch(() => {})
  const itens = await menu(page)
  const i = itens.indexOf('Mesas e Comandas')
  ok(`${usuario} (${tela.width}px) vê "Mesas e Comandas" no menu`, i >= 0, itens.slice(0, 6).join(' › '))
  if (usuario !== USU.garcom) ok(`${usuario} (${tela.width}px): logo depois do PDV`, i > 0 && itens[i - 1] === 'PDV', itens[i - 1])
  await page.locator('aside a', { hasText: 'Mesas e Comandas' }).first().click()
  await page.waitForURL('**/admin/mesas', { timeout: 15000 }).catch(() => {})
  ok(`${usuario} (${tela.width}px): o item leva ao salão`, new URL(page.url()).pathname === '/admin/mesas', new URL(page.url()).pathname)
  await page.screenshot({ path: `.shots/menu-${usuario.split('.')[0]}-${tela.width}.png` })
  await ctx.close()
}

{
  const { ctx, page } = await logar(USU.dono, DESKTOP)
  await page.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  const ok1 = page.locator('button', { hasText: 'OK, entendi' })
  if (await ok1.count()) await ok1.first().click()
  await page.getByRole('button', { name: 'Mesas', exact: true }).first().click()
  await page.getByText('Módulo Mesas e Comandas').waitFor({ timeout: 15000 })
  await page.getByLabel('Taxa de serviço padrão').waitFor({ timeout: 15000 })
  const texto = await page.locator('main').innerText()
  ok('Ajustes › Mesas mostra taxa, formas e regras (configuração)', /Formas de pagamento aceitas/i.test(texto) && /Quem pode o quê no salão/i.test(texto))
  ok('Ajustes › Mesas não tem atalho "Abrir o salão"', (await page.getByRole('button', { name: /Abrir o salão/i }).count()) === 0)
  ok('Ajustes › Mesas não tem cadastro de mesas com o módulo ligado', (await page.getByPlaceholder(/Nome da mesa/).count()) === 0)
  ok('e aponta o menu lateral para a operação', /no menu lateral/i.test(texto))
  await page.screenshot({ path: '.shots/menu-ajustes-mesas.png', fullPage: true })
  await ctx.close()
}

console.log('\n── módulo desligado ──')
await db.query(`update restaurantes set modulo_mesas_ativo = false where id = $1`, [loja])
{
  const { ctx, page } = await logar(USU.dono, DESKTOP)
  const itens = await menu(page)
  ok('dono não vê o item com o módulo desligado', !itens.includes('Mesas e Comandas'), itens.slice(0, 5).join(' › '))
  await page.goto(`${BASE}/admin/mesas`, { waitUntil: 'domcontentloaded' })
  ok('acesso direto a /admin/mesas é redirecionado', new URL(page.url()).pathname !== '/admin/mesas', new URL(page.url()).pathname)
  const api = await page.evaluate(async () => (await fetch('/api/admin/mesas/chamados')).status)
  ok('API do salão responde 404', api === 404, `HTTP ${api}`)
  await page.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  const ok1 = page.locator('button', { hasText: 'OK, entendi' })
  if (await ok1.count()) await ok1.first().click()
  await page.getByRole('button', { name: 'Mesas', exact: true }).first().click()
  await page.getByText('Módulo Mesas e Comandas').waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  ok('desligado, Ajustes › Mesas mantém o cadastro simples do PDV', (await page.getByPlaceholder(/Nome da mesa/).count()) === 1)
  await ctx.close()
}
await db.query(`update restaurantes set modulo_mesas_ativo = true where id = $1`, [loja])

await browser.close()
await db.end()
const falhas = res.filter((r) => !r).length
console.log(`\n${falhas === 0 ? '✅' : '❌'} ${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
