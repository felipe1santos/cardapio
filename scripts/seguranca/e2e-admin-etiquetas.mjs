/**
 * E2E — admin, Fase 3 (2026-09-30): "Etiquetas do produto" no cadastro do item, prévia
 * ao vivo e gravação; dica do tamanho ideal do banner (1200 × 850). Dono da cantina-pdv2.
 * Cria "TESTE Etiquetas Admin" pelo banco, edita pela tela, confere no banco e na vitrine,
 * e apaga no fim.
 *
 *   node scripts/seguranca/e2e-admin-etiquetas.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id, slug from restaurantes where slug='cantina-pdv2'`)
const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 order by posicao nulls last limit 1`, [loja.id])
const NOME = 'TESTE Etiquetas Admin'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
let itemId = null
try {
  itemId = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, dias_disponiveis, tipo_item, tag)
    values ($1,$2,$3,'Para testar o cadastro',20,'disponivel','{0,1,2,3,4,5,6}','simples','edicao_limitada') returning id`, [loja.id, grupo.id, NOME])).id
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.pdv2@local.test')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/cardapio`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  await p.getByPlaceholder('Buscar item…').first().fill(NOME)
  await p.waitForTimeout(600)
  await p.locator('tr', { hasText: NOME }).getByTitle('Editar').first().click()
  await p.getByRole('button', { name: /Exibição/ }).first().click()
  const sec = p.getByTestId('etiquetas-produto')
  await sec.waitFor({ timeout: 10000 })
  ok('seção "Etiquetas do produto" no cadastro', await sec.isVisible())
  ok('etiqueta antiga (Edição limitada) migrou para a caixa nova', await p.getByTestId('etiqueta-edicao-limitada').isChecked())
  await p.getByTestId('etiqueta-mais-pedido').check()
  await p.getByTestId('etiqueta-novidade').check()
  await p.getByTestId('etiqueta-promocional').check()
  await p.getByTestId('etiqueta-entrega-gratis').check()
  await p.getByTestId('etiqueta-serve').fill('3')
  const previa = p.getByTestId('etiquetas-previa')
  const tipos = await previa.locator('[data-etiquetas-principais] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.getAttribute('data-etiqueta')))
  ok('prévia ao vivo: 3 marcadas → 2 principais na ordem', JSON.stringify(tipos) === JSON.stringify(['mais_pedido', 'novidade']), tipos.join(','))
  ok('prévia mostra as utilitárias', /Item promocional/.test(await previa.innerText()) && /Serve 3 pessoas/.test(await previa.innerText()) && /Entrega grátis/.test(await previa.innerText()))
  if (PRINTS) await sec.screenshot({ path: join(PRINTS, 'admin-etiquetas.png') })
  await p.getByRole('button', { name: 'Concluir' }).click()
  await p.waitForTimeout(1500)
  const salvo = await um(`select mais_vendido, novidade_ate > now() + interval '25 days' novidade30, edicao_limitada, item_promocional, entrega_gratis, serve_pessoas, tag from itens_cardapio where id=$1`, [itemId])
  ok('gravado: Mais pedido, Novidade (30 dias), Edição limitada, Promocional, Entrega grátis, Serve 3; tag antiga zerada',
    salvo.mais_vendido && salvo.novidade30 && salvo.edicao_limitada && salvo.item_promocional && salvo.entrega_gratis && salvo.serve_pessoas === 3 && salvo.tag === null, JSON.stringify(salvo))

  // Na vitrine
  const v = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage()
  await v.goto(`${BASE}/loja/${loja.slug}`, { waitUntil: 'networkidle' })
  await v.getByRole('button', { name: 'Continuar no cardápio' }).click({ timeout: 2500 }).catch(() => {})
  const linha = v.locator(`button[data-item-id="${itemId}"]`).last()
  await linha.scrollIntoViewIfNeeded().catch(() => {})
  ok('vitrine mostra o que foi salvo no cadastro', (await linha.locator('[data-etiqueta]').count()) === 5, String(await linha.locator('[data-etiqueta]').count()))

  // Banner: dica do tamanho ideal
  await p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  const corpo = await p.locator('body').innerText()
  const achou = /1200 × 850/.test(corpo) || await p.getByText(/1200 × 850/).count().then((n) => n > 0)
  ok('Ajustes: banner promocional mostra "Tamanho ideal: 1200 × 850 px"', achou)
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (itemId) await db.query(`delete from itens_cardapio where id=$1`, [itemId])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
