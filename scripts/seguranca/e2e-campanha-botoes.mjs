/**
 * E2E — Fase 4 (2026-09-30): botões de link nas campanhas, provedor SIMULADO.
 *   · editor: "Botões (opcional)", atalho "Ver cardápio", validação de https, prévia;
 *   · disparo: a mensagem sai com os links no texto, um por linha (fallback sempre);
 *   · histórico da central registra que os botões foram como links;
 *   · campanha antiga (sem botões) continua saindo igual.
 * Loja camp-e2e-a (semeada pelo e2e-campanhas-metricas). Só cliente fictício.
 *
 *   CAMP_PROVEDOR=simulado WHATSAPP_SIMULADO_ARQUIVO=<o do servidor> CRON_SECRET=<o do servidor> \
 *     node scripts/seguranca/e2e-campanha-botoes.mjs [pasta-de-prints]
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const ARQ = process.env.WHATSAPP_SIMULADO_ARQUIVO
if (process.env.CAMP_PROVEDOR !== 'simulado' || !ARQ || !process.env.CRON_SECRET) { console.error('Trava: provedor simulado, arquivo e CRON_SECRET.'); process.exit(2) }
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id, slug from restaurantes where slug='camp-e2e-a'`)
if (!loja) { console.error('Rode antes o e2e-campanhas-metricas (semeia a loja camp-e2e-a).'); process.exit(2) }
const TEL = '5511987650001'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const enviados = () => (existsSync(ARQ) ? readFileSync(ARQ, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const cron = () => fetch(`${BASE}/api/cron/campanhas`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } })
const browser = await chromium.launch()
try {
  await db.query(`delete from campanhas where restaurante_id=$1`, [loja.id])
  await db.query(`delete from clientes where restaurante_id=$1`, [loja.id])
  await db.query(`insert into clientes (restaurante_id, nome, telefone) values ($1,'TESTE Botões',$2)`, [loja.id, TEL])
  if (existsSync(ARQ)) rmSync(ARQ)

  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono@camp-a.local')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/campanhas`, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /OK, entendi/ }).click({ timeout: 2500 }).catch(() => {})
  await p.getByRole('button', { name: /Nova campanha/ }).first().click()
  await p.getByPlaceholder(/Promoção|Nome/).first().fill('TESTE Campanha com botões').catch(() => {})
  const nome = p.locator('input').first()
  if (!(await nome.inputValue())) await nome.fill('TESTE Campanha com botões')
  await p.locator('textarea').first().fill('Hoje tem promoção, {nome}!')
  // Sem o link rastreável, para o texto ficar previsível.
  const linkRastreavel = p.getByText(/link do cardápio/i).first()
  const chk = p.locator('label', { has: linkRastreavel }).locator('input[type="checkbox"]')
  if (await chk.count() && await chk.isChecked()) await chk.uncheck()
  const sec = p.getByTestId('campanha-botoes')
  ok('editor tem "Botões (opcional)"', await sec.isVisible())
  await p.getByTestId('botao-ver-cardapio').click()
  ok('atalho "Ver cardápio" preenche o link da vitrine da loja', (await p.getByTestId('botao-url-0').inputValue()) === `https://app.menuzia.com.br/loja/${loja.slug}`)
  await p.getByTestId('botao-adicionar').click()
  await p.getByTestId('botao-texto-1').fill('Pegar cupom')
  await p.getByTestId('botao-url-1').fill('http://inseguro.com')
  await p.getByRole('button', { name: /Disparar agora/ }).click()
  await p.waitForTimeout(800)
  ok('link sem https é recusado com mensagem clara', /https/.test(await p.locator('body').innerText()))
  await p.getByTestId('botao-url-1').fill(`https://app.menuzia.com.br/loja/${loja.slug}?cupom=TESTE`)
  const previa = await p.locator('body').innerText()
  ok('prévia mostra os botões como vão chegar (links no texto)', previa.includes('👉 Ver cardápio:') && previa.includes('👉 Pegar cupom:'))
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'editor-botoes.png') })
  await p.getByRole('button', { name: /Disparar agora/ }).click()
  await p.waitForTimeout(1500)
  const camp = await um(`select id, botoes from campanhas where restaurante_id=$1 order by criado_em desc limit 1`, [loja.id])
  ok('campanha gravada com 2 botões', Array.isArray(camp?.botoes) && camp.botoes.length === 2, JSON.stringify(camp?.botoes))

  for (let i = 0; i < 3 && !enviados().length; i++) { await cron(); await new Promise((r) => setTimeout(r, 800)) }
  const saida = enviados().find((e) => String(e.numero ?? e.telefone ?? '').endsWith('987650001'))
  const texto = saida?.texto ?? saida?.text ?? ''
  ok('só o cliente de teste recebeu (provedor simulado)', enviados().length === 1, String(enviados().length))
  ok('mensagem saiu com os links no texto, um por linha', texto.includes(`👉 Ver cardápio: https://app.menuzia.com.br/loja/${loja.slug}`) && texto.includes('👉 Pegar cupom: https://'), texto.slice(0, 200))
  const hist = await um(`select texto from whatsapp_mensagens where restaurante_id=$1 and origem='disparo' order by criado_em desc limit 1`, [loja.id])
  ok('histórico da central registra que os botões foram como links', /botões enviados como links/.test(hist?.texto ?? ''))

  // Campanha antiga (sem botões): sai igual.
  if (existsSync(ARQ)) rmSync(ARQ)
  const antiga = (await um(`insert into campanhas (restaurante_id, nome, status, mensagem, agendado_em) values ($1,'TESTE Antiga','agendada','Promo sem botões', now()) returning id`, [loja.id])).id
  await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente, telefone_chave) values ($1,$2,$3,'TESTE', telefone_chave($3))`, [antiga, loja.id, TEL]).catch(async () => {
    await db.query(`insert into campanha_envios (campanha_id, restaurante_id, telefone, nome_cliente) values ($1,$2,$3,'TESTE')`, [antiga, loja.id, TEL])
  })
  for (let i = 0; i < 3 && !enviados().length; i++) { await cron(); await new Promise((r) => setTimeout(r, 800)) }
  const t2 = enviados()[0]?.texto ?? enviados()[0]?.text ?? ''
  ok('campanha antiga sem botões sai igual (sem linhas 👉)', t2.startsWith('Promo sem botões') && !t2.includes('👉'), t2.slice(0, 80))
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`delete from campanhas where restaurante_id=$1 and nome like 'TESTE%'`, [loja.id])
  await db.query(`delete from clientes where restaurante_id=$1 and nome like 'TESTE%'`, [loja.id])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
