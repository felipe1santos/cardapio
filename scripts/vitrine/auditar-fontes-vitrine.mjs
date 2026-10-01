/**
 * Auditoria de fonte da vitrine (2026-10-01): abre cada tela/etapa em 390 px e lista a
 * font-family CALCULADA de todo texto visível (inclui inputs, botões e selects). Nenhuma
 * pode fugir da família da vitrine. Tira print de cada etapa (entrega e retirada).
 *
 *   node scripts/vitrine/auditar-fontes-vitrine.mjs [pasta-de-prints]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = process.env.SLUG ?? 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id from restaurantes where slug=$1`, [SLUG])).rows[0]
await db.query(`update restaurantes set aceita_entrega=true, aceita_retirada=true where id=$1`, [loja.id])
const TEL = '27999880055'

const res = []
const linhas = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

async function fontes(p) {
  return p.evaluate(() => {
    const out = new Map()
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight }
    for (const el of document.querySelectorAll('body *')) {
      if (['SCRIPT', 'STYLE', 'svg', 'path', 'NOSCRIPT', 'IMG'].includes(el.tagName)) continue
      const temTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)
      if (!temTexto || !vis(el)) continue
      const f = getComputedStyle(el).fontFamily
      if (!out.has(f)) out.set(f, `${el.tagName.toLowerCase()} "${(el.value ?? el.textContent ?? '').trim().slice(0, 30)}"`)
    }
    return [...out].map(([f, ex]) => ({ f, ex }))
  })
}

async function etapa(p, nome) {
  await p.waitForTimeout(500)
  const fs = await fontes(p)
  const fora = fs.filter((x) => !/Montserrat/i.test(x.f.split(',')[0]) && !/__Montserrat|vitrine/i.test(x.f.split(',')[0]))
  linhas.push(`${nome}: ${fs.map((x) => x.f.split(',')[0]).join(' · ')}`)
  ok(`${nome}: só a fonte da vitrine`, fora.length === 0, fora.map((x) => `${x.f} em ${x.ex}`).join(' | '))
  if (PRINTS) await p.screenshot({ path: join(PRINTS, `${nome.replace(/[^\w-]+/g, '-').toLowerCase()}.png`) })
}

const browser = await chromium.launch()
try {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  for (const tipo of ['entrega', 'retirada']) {
    console.log(`\n── ${tipo} ──`)
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => localStorage.clear())
    await p.reload({ waitUntil: 'networkidle' })
    if (tipo === 'entrega') {
      await etapa(p, '01 home')
      await p.getByRole('button', { name: /^Pedidos$/ }).first().tap(); await etapa(p, '02 aba pedidos')
      await p.getByRole('button', { name: /^Cupons$/ }).first().tap(); await etapa(p, '03 aba cupons')
      await p.getByRole('button', { name: /^Entrar$/ }).first().tap(); await etapa(p, '04 login')
      await p.keyboard.press('Escape'); await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    }
    await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
    await etapa(p, `05 ficha do produto`)
    await p.getByRole('button', { name: /Adicionar/ }).last().tap()
    await p.waitForTimeout(500)
    await p.getByText('Ver sacola').first().tap()
    await p.getByRole('button', { name: tipo === 'entrega' ? /^Entrega/ : /^Retirada/ }).first().tap().catch(() => {})
    await etapa(p, `06 sacola ${tipo}`)
    await p.getByRole('button', { name: /Continuar para pagamento/ }).last().tap()
    const tel = p.getByPlaceholder('(00) 00000-0000').first()
    await tel.waitFor({ timeout: 8000 })
    await etapa(p, `07 telefone ${tipo}`)
    await tel.fill(TEL)
    await p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByRole('button', { name: /^Continuar$/i }).tap()
    await p.waitForTimeout(1200)
    await p.getByText('Dinheiro', { exact: true }).first().tap()
    await etapa(p, `08 pagamento ${tipo} (troco)`)
    await p.getByText('Pix', { exact: true }).first().tap()
    await p.getByRole('button', { name: /Ir para endereço|Continuar/ }).last().tap()
    await p.waitForTimeout(600)
    await p.getByPlaceholder('Seu nome').fill('TESTE Fonte')
    if (tipo === 'entrega') {
      await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro')
      await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
      await p.getByPlaceholder('123').fill('10')
      await p.waitForTimeout(800)
    }
    await etapa(p, `09 ${tipo === 'entrega' ? 'endereço' : 'seus dados'}`)
    await p.getByRole('button', { name: /Revisar pedido/ }).tap()
    await etapa(p, `10 revisar ${tipo}`)
    await p.getByRole('button', { name: /Fazer pedido/ }).tap()
    await p.waitForTimeout(2500)
    await etapa(p, `11 pedido feito ${tipo}`)
    await ctx.close()
  }
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  await browser.close(); await db.end()
}
if (PRINTS) writeFileSync(join(PRINTS, 'fontes.txt'), linhas.join('\n') + '\n')
console.log('\n' + linhas.join('\n'))
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
