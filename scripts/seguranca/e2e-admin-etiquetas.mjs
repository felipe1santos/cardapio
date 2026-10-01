/**
 * E2E — admin (2026-10-01, tags repaginadas): "Etiquetas do produto" no cadastro do item, prévia
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
  // Repaginação 2026-10: etiquetas têm aba própria no modal do produto.
  await p.getByTestId('produto-aba-etiquetas').click()
  const sec = p.getByTestId('etiquetas-produto')
  await sec.waitFor({ timeout: 10000 })
  ok('seção "Etiquetas do produto" no cadastro', await sec.isVisible())
  ok('etiqueta antiga (Edição limitada) virou Oferta limitada', await p.getByTestId('etiqueta-oferta-limitada').isChecked())
  ok('Mais vendido é automático (estrela), com o estado de agora', /automático/.test(await p.getByTestId('etiqueta-mais-vendido-auto').innerText()))
  await p.getByTestId('etiqueta-combo').check()
  await p.getByTestId('etiqueta-novidade').check()
  await p.getByTestId('etiqueta-promocional').check()
  ok('3 de topo ligadas → aviso das 2 mais importantes', await p.getByTestId('aviso-topo').isVisible())
  await p.getByTestId('etiqueta-serve-ligar').check()
  ok('Serve começa em 2', (await p.getByTestId('serve-texto').innerText()) === 'Serve até 2 pessoas')
  await p.getByTestId('serve-mais').click(); await p.getByTestId('serve-mais').click()
  await p.getByTestId('serve-menos').click()
  ok('− / + atualiza ao vivo', (await p.getByTestId('serve-texto').innerText()) === 'Serve até 3 pessoas')
  await p.getByTestId('etiqueta-personalizada-ligar').check()
  await p.getByTestId('etiqueta-personalizada-texto').fill('Receita da casa especial e mais coisa')
  ok('personalizada corta em 24 com contador', (await p.getByTestId('etiqueta-personalizada-texto').inputValue()).length === 24 && (await p.getByTestId('etiqueta-personalizada-contador').innerText()) === '24/24')
  await p.getByTestId('etiqueta-personalizada-azul').click()
  const previa = p.getByTestId('etiquetas-previa')
  const tipos = await previa.locator('[data-etiquetas-principais] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.getAttribute('data-etiqueta')))
  ok('prévia ao vivo: Combo especial + Oferta limitada (Novidade fica de fora)', JSON.stringify(tipos) === JSON.stringify(['combo_especial', 'oferta_limitada']), tipos.join(','))
  ok('prévia mostra as utilitárias', /Serve até 3 pessoas/.test(await previa.innerText()) && /Item promocional/.test(await previa.innerText()) && (await previa.locator('[data-etiqueta="personalizada"][data-cor="azul"]').count()) === 1)
  if (PRINTS) await sec.screenshot({ path: join(PRINTS, 'admin-etiquetas.png') })
  await p.getByTestId('produto-salvar').click()
  await p.waitForTimeout(1500)
  ok('salvar mostra o toast de confirmação', (await p.getByTestId('toast').count()) > 0)
  const salvo = await um(`select combo_especial, novidade_ate > now() + interval '25 days' novidade30, edicao_limitada, item_promocional, serve_pessoas, tag_personalizada, tag_personalizada_cor, tag from itens_cardapio where id=$1`, [itemId])
  ok('gravado: Combo, Novidade, Oferta limitada, Promocional, Serve 3, personalizada azul (24); tag antiga zerada',
    salvo.combo_especial && salvo.novidade30 && salvo.edicao_limitada && salvo.item_promocional && salvo.serve_pessoas === 3 && salvo.tag_personalizada === 'Receita da casa especial' && salvo.tag_personalizada_cor === 'azul' && salvo.tag === null, JSON.stringify(salvo))
  const banco = await db.query(`update itens_cardapio set tag_personalizada = repeat('x', 25) where id=$1`, [itemId]).then(() => 'passou', (e) => e.message)
  ok('banco recusa personalizada com mais de 24', /check/.test(banco), banco)

  // Na vitrine
  const v = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })).newPage()
  await v.goto(`${BASE}/loja/${loja.slug}`, { waitUntil: 'networkidle' })
  await v.getByRole('button', { name: 'Continuar no cardápio' }).click({ timeout: 2500 }).catch(() => {})
  const linha = v.locator(`button[data-item-id="${itemId}"]`).last()
  await linha.scrollIntoViewIfNeeded().catch(() => {})
  ok('vitrine mostra o que foi salvo (2 de topo + 3 utilitárias)', (await linha.locator('[data-etiqueta]').count()) === 5, String(await linha.locator('[data-etiqueta]').count()))

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
