/**
 * E2E — ficha de preparo cadastrada pelo Cardápio (Fase 5.3). Dono da cantina-pdv2.
 *   node scripts/seguranca/e2e-ficha-admin.mjs
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'
const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug='cantina-pdv2'`)
const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 limit 1`, [loja.id])
const res = []; const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const NOME = 'TESTE Ficha Admin'
const b = await chromium.launch(); let itemId = null
try {
  itemId = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, dias_disponiveis, tipo_item) values ($1,$2,$3,'',25,'disponivel','{0,1,2,3,4,5,6}','simples') returning id`, [loja.id, grupo.id, NOME])).id
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage()
  await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', 'dono.pdv2@local.test'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL(/admin/), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' }); await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  await p.getByPlaceholder('Buscar item…').first().fill(NOME); await p.waitForTimeout(600)
  await p.locator('tr', { hasText: NOME }).getByTitle('Editar').first().click()
  await p.getByRole('button', { name: /Exibição/ }).first().click()
  await p.getByTestId('ficha-preparo').waitFor()
  await p.getByTestId('ficha-add-ing').click(); await p.getByTestId('ficha-ing-nome-0').fill('Pão'); await p.getByTestId('ficha-ing-qtd-0').fill('1 un')
  await p.getByTestId('ficha-add-passo').click(); await p.getByTestId('ficha-passo-0').fill('Tostar o pão')
  await p.getByTestId('ficha-add-passo').click(); await p.getByTestId('ficha-passo-1').fill('Montar')
  await p.getByTestId('ficha-tempo').fill('8')
  await p.getByTestId('ficha-salvar').click(); await p.waitForTimeout(1200)
  const f = await um(`select ingredientes, passos, tempo_min from fichas_preparo where item_id=$1`, [itemId])
  ok('ficha salva pelo Cardápio (1 ingrediente, 2 passos, 8 min)', f && f.ingredientes.length === 1 && f.passos.length === 2 && f.tempo_min === 8, JSON.stringify(f))
  const anon = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:54321'}/rest/v1/fichas_preparo?select=*`, { headers: { apikey: process.env.ANON_KEY, Authorization: `Bearer ${process.env.ANON_KEY}` } })
  const corpo = await anon.json().catch(() => null)
  ok('receita NÃO sai para o visitante (anon)', !Array.isArray(corpo) || corpo.length === 0, `${anon.status}`)
} catch (e) { console.error(e); res.push(false) } finally {
  if (itemId) await db.query(`delete from itens_cardapio where id=$1`, [itemId])
  await b.close(); await db.end()
}
const falhas = res.filter((x) => !x).length; console.log(`\n${res.length - falhas}/${res.length} verificações passaram`); process.exit(falhas ? 1 : 0)
