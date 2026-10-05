/**
 * Kanban — ícone da ORIGEM no card e no painel (item 55; o visual do item 56 foi desfeito a pedido do dono
 * em 2026-10-05: o Kanban voltou ao de antes, ficou só a origem). Loja local `dash54-loja`.
 *   · pedido da vitrine com origem (Meta, Instagram, Google, WhatsApp) → ícone + nome no card, com a dica;
 *   · Direto → nada; PDV/balcão → continua o selo "PDV" de sempre;
 *   · painel lateral mostra "Origem: …".
 *   node scripts/kanban/e2e-kanban-origem.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug='dash54-loja'`)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const criados = []
const CASOS = [
  { n: 'Cliente Meta', oc: 'meta', det: { campanha: 'outubro' }, esperado: 'meta', rotulo: 'Meta', dica: 'Origem: Meta (campanha outubro)' },
  { n: 'Cliente Insta', oc: 'instagram', det: null, esperado: 'instagram', rotulo: 'Instagram', dica: 'Origem: Instagram' },
  { n: 'Cliente Google', oc: 'google_anuncio', det: null, esperado: 'google_anuncio', rotulo: 'Google', dica: 'Origem: Google' },
  { n: 'Cliente Zap', oc: 'whatsapp', det: { meio: 'robo' }, esperado: 'whatsapp', rotulo: 'WhatsApp', dica: 'Origem: WhatsApp (robô de atendimento)' },
  { n: 'Cliente Direto', oc: 'direto', det: null, esperado: null },
  { n: 'Cliente Balcao', oc: null, det: null, esperado: null, canal: 'balcao', origem: 'pdv', tipo: 'retirada' },
]
const browser = await chromium.launch()
try {
  for (const c of CASOS) {
    const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, origem_canal, origem_detalhe, observacao, endereco_rua)
      values ($1,$2,'recebido',20,20,$3,'27999001122','pix',$4,$5,$6,$7,'','') returning id, numero`, [loja.id, c.tipo ?? 'entrega', c.n, c.canal ?? 'delivery', c.origem ?? 'cardapio', c.oc, c.det])
    criados.push(p.id); c.numero = p.numero
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.dash54'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await p.getByTestId(`pedido-${CASOS[0].numero}`).waitFor({ timeout: 20000 })
  const aviso = p.locator('[aria-labelledby="setup-alerta-titulo"]').first()
  if (await aviso.isVisible().catch(() => false)) await aviso.click({ position: { x: 5, y: 5 } }).catch(() => {})
  for (const c of CASOS) {
    const card = p.getByTestId(`pedido-${c.numero}`)
    const el = card.getByTestId('card-origem')
    const o = await el.getAttribute('data-origem').catch(() => null)
    if (c.esperado) {
      ok(`${c.n}: ícone e nome da origem (${c.rotulo})`, o === c.esperado && (await el.textContent()).includes(c.rotulo) && (await el.locator('svg').count()) > 0, String(o))
      ok(`${c.n}: dica "${c.dica}"`, (await el.getAttribute('title')) === c.dica, await el.getAttribute('title'))
    } else {
      ok(`${c.n}: sem ícone de origem`, (await el.count()) === 0)
    }
  }
  const pix = await p.getByTestId(`pedido-${CASOS[0].numero}`).getByTestId('card-pagamento').locator('svg').getAttribute('fill')
  ok('ícone oficial do Pix (mantido do item 56)', pix === '#32BCAD', String(pix))
  ok('balcão continua com o selo "PDV" de antes', /PDV/.test(await p.getByTestId(`pedido-${CASOS[5].numero}`).getByTestId('selo-origem').textContent()))
  ok('card de antes: botão de etapa com texto ("Aceitar")', /Aceitar/.test(await p.getByTestId(`pedido-${CASOS[0].numero}`).getByTestId('card-etapa').textContent()))
  if (PRINTS) await p.screenshot({ path: `${PRINTS}/kanban-origem.png` })
  await p.getByTestId(`pedido-${CASOS[0].numero}`).click()
  await p.getByTestId('painel-origem').waitFor({ timeout: 5000 }).catch(() => {})
  ok('painel lateral: "Origem: Meta (campanha outubro)"', /Meta \(campanha outubro\)/.test(await p.getByTestId('painel-origem').textContent().catch(() => '')))
  if (PRINTS) await p.screenshot({ path: `${PRINTS}/kanban-origem-painel.png` })
  await ctx.close()
} finally {
  await browser.close()
  if (criados.length) await db.query(`delete from pedidos where id = any($1)`, [criados]).catch(() => {})
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
