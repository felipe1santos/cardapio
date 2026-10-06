/**
 * Prints da pendência 7 (versão compacta no celular): Mesas e Comandas, tela da mesa e PDV,
 * como dono e como garçom, em 390 (e 360/430 com SO_CELULAR=0), tablet e desktop.
 * Loja local semeada (E2E_LOJA, padrão cantina-e2e), PDV v2 ligado só durante o script.
 *
 *   E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node scripts/celular-p7/shots.mjs <antes|depois>
 */
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
import { E2E_LOJA, USU } from '../seguranca/e2e-ambiente.mjs'

const ROT = process.argv[2] ?? 'depois'
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const DIR = 'docs/celular-p7'
mkdirSync(DIR, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const loja = (await db.query(`select id, pdv_v2 from restaurantes where slug=$1`, [E2E_LOJA])).rows[0]
await db.query(`update restaurantes set pdv_v2=true where id=$1`, [loja.id])
const ocupada = (await db.query(`select m.id from mesas m join comandas c on c.mesa_id=m.id and c.status='aberta' where m.restaurante_id=$1 limit 1`, [loja.id])).rows[0]
const browser = await chromium.launch()
const TAM = process.env.SO_CELULAR === '0' ? [['360', 360, 800], ['390', 390, 844], ['430', 430, 932], ['tablet', 820, 1180], ['desktop', 1366, 900]] : [['390', 390, 844]]
try {
  for (const [quem, login] of [['dono', USU.dono], ['garcom', USU.garcom]]) {
    for (const [nome, w, h] of TAM) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1024, isMobile: w < 768, deviceScaleFactor: 2, locale: 'pt-BR' })
      const p = await ctx.newPage()
      await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
      await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', 'demo-local-123456')
      await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
      const fechar = async () => { const m = p.locator('[aria-labelledby="setup-alerta-titulo"]').first(); if (await m.isVisible().catch(() => false)) { await m.getByRole('button', { name: 'OK' }).first().click().catch(() => m.click({ position: { x: 5, y: 5 } }).catch(() => {})); await p.waitForTimeout(300) } }
      const shot = async (tela) => { await p.waitForTimeout(1800); await fechar(); await p.screenshot({ path: `${DIR}/${ROT}-${quem}-${nome}-${tela}.png`, fullPage: true }); console.log('•', quem, nome, tela) }
      for (const [tela, url] of [['mesas', '/admin/mesas'], ['mesa', ocupada ? `/admin/mesas/${ocupada.id}` : null], ['pdv', '/admin/pdv']]) {
        if (!url) continue
        await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => {})
        await shot(tela)
      }
      await ctx.close()
    }
  }
} finally {
  await db.query(`update restaurantes set pdv_v2=$2 where id=$1`, [loja.id, loja.pdv_v2])
  await browser.close(); await db.end()
}
