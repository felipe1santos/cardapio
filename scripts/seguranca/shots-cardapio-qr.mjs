/**
 * Capturas de comparação (antes/depois) do cardápio da mesa (QR), da vitrine e do Gestor,
 * na loja isolada `ordem-qr-e2e`. Só leitura de tela: não grava pedido, seleção nem ordem
 * (o modo do QR é trocado e devolvido ao estado inicial no `finally`).
 *
 *   BASE=http://127.0.0.1:3998 ROTULO=antes SHOTS=<pasta> node scripts/seguranca/shots-cardapio-qr.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
import { LOJA, SENHA, USUARIOS } from './semear-cardapio-ordem.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const ROTULO = process.env.ROTULO ?? 'depois'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-shots-cardapio-qr')
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
mkdirSync(SHOTS, { recursive: true })

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const loja = await um(`select id, mesa_somente_visualizacao v from restaurantes where slug=$1`, [LOJA])
const mesa = await um(`select token from mesas where restaurante_id=$1 and nome='Mesa 1'`, [loja.id])
const browser = await chromium.launch()
const shot = (page, nome, full = false) => page.screenshot({ path: join(SHOTS, `${ROTULO}-${nome}.png`), fullPage: full })

try {
  // Vitrine
  {
    const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
    await p.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
    await shot(p, 'vitrine-390', true)
    await p.getByText('X-Burger', { exact: true }).first().click()
    await p.waitForTimeout(700)
    await shot(p, 'vitrine-390-ficha')
  }
  // QR: visualização e ativo
  for (const modo of ['visualizacao', 'ativo']) {
    await db.query(`update restaurantes set mesa_somente_visualizacao=$2 where id=$1`, [loja.id, modo === 'visualizacao'])
    for (const [w, h] of [[390, 844], [1366, 768]]) {
      const p = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 })).newPage()
      await p.goto(`${BASE}/mesa/${mesa.token}`, { waitUntil: 'networkidle' })
      await p.waitForTimeout(600)
      await shot(p, `qr-${modo}-${w}`)
      await p.locator('.mesa-card', { hasText: 'X-Salada' }).first().click()
      await p.waitForTimeout(600)
      await shot(p, `qr-${modo}-${w}-ficha-xsalada`)
      await p.keyboard.press('Escape')
      await p.locator('.mesa-fechar').click({ timeout: 1500 }).catch(() => {})
      await p.waitForTimeout(300)
      await p.locator('.mesa-card', { hasText: 'X-Burger' }).first().click()
      await p.waitForTimeout(600)
      await shot(p, `qr-${modo}-${w}-ficha-xburger`)
    }
  }
  // Gestor
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', USUARIOS.dono)
    await p.fill('input[name="password"]', SENHA)
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
    await p.getByRole('button', { name: /OK, entendi|Fechar/ }).first().click({ timeout: 2000 }).catch(() => {})
    await p.locator('aside button', { hasText: 'Bebidas' }).first().click()
    await p.waitForTimeout(600)
    await shot(p, 'gestor-1366-bebidas')
  }
  console.log(`✅ capturas "${ROTULO}" em ${SHOTS}`)
} finally {
  await db.query(`update restaurantes set mesa_somente_visualizacao=$2 where id=$1`, [loja.id, loja.v])
  await browser.close()
  await db.end()
}
