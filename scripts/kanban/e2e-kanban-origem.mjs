/**
 * Kanban — card ANTIGO (o de antes do item 56) + o ÍCONE DA ORIGEM (decisão do dono, 2026-10-07).
 * Loja local `dash54-loja`.
 *   · origem da vitrine (Meta, Facebook, Instagram, Google, WhatsApp, QR Code, Outros) → só o ícone,
 *     pequeno, colado no número, com a dica "Origem: Instagram – campanha X" (camada máxima);
 *   · selo do ícone com fundo sólido e desenho branco, contraste ≥ 4,5:1;
 *   · Direto, PDV, Mesa e Balcão → sem ícone; o card não ganha linha (mesma altura de um Direto);
 *   · pagamento com os ícones antigos; painel lateral mostra "Origem: …".
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
  { n: 'Cliente Meta', oc: 'meta', det: { campanha: 'outubro' }, esperado: 'meta', dica: 'Origem: Meta – campanha outubro' },
  { n: 'Cliente Insta', oc: 'instagram', det: null, esperado: 'instagram', dica: 'Origem: Instagram' },
  { n: 'Cliente Face', oc: 'facebook', det: null, esperado: 'facebook', dica: 'Origem: Facebook' },
  { n: 'Cliente Google', oc: 'google_anuncio', det: null, esperado: 'google_anuncio', dica: 'Origem: Google' },
  { n: 'Cliente Zap', oc: 'whatsapp', det: { meio: 'robo' }, esperado: 'whatsapp', dica: 'Origem: WhatsApp – robô de atendimento' },
  { n: 'Cliente QR', oc: 'qrcode', det: null, esperado: 'qrcode', dica: 'Origem: QR Code' },
  { n: 'Cliente Outros', oc: 'outros', det: null, esperado: 'outros', dica: 'Origem: Outros' },
  { n: 'Cliente Direto', oc: 'direto', det: null, esperado: null },
  { n: 'Cliente Balcao', oc: null, det: null, esperado: null, canal: 'balcao', origem: 'pdv', tipo: 'retirada' },
]
const lum = (rgb) => { const v = rgb.match(/\d+/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
const contrasteBranco = (rgb) => 1.05 / (lum(rgb) + 0.05)
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
      const m = await el.evaluate((e) => {
        const num = e.closest('[data-testid^="pedido-"]').querySelector('span.rounded-menuzia')
        const rn = num.getBoundingClientRect(), re = e.getBoundingClientRect()
        const selo = e.querySelector('[data-selo-origem]')
        return { texto: e.textContent.trim(), ladoDoNumero: re.left - rn.right, mesmaLinha: Math.abs((re.top + re.bottom) / 2 - (rn.top + rn.bottom) / 2), w: re.width, h: re.height, fundo: selo && getComputedStyle(selo).backgroundColor, svg: e.querySelectorAll('svg').length }
      })
      ok(`${c.n}: só o ícone (${c.esperado}), pequeno, colado no número`, o === c.esperado && m.texto === '' && m.svg === 1 && m.w <= 20 && m.h <= 20 && m.ladoDoNumero >= 0 && m.ladoDoNumero <= 12 && m.mesmaLinha <= 3, JSON.stringify(m))
      ok(`${c.n}: selo sólido com desenho branco (contraste ≥ 4,5)`, !!m.fundo && contrasteBranco(m.fundo) >= 4.5, `${m.fundo} ${m.fundo && contrasteBranco(m.fundo).toFixed(2)}`)
      ok(`${c.n}: dica "${c.dica}"`, (await el.getAttribute('aria-label')) === c.dica, await el.getAttribute('aria-label'))
    } else {
      ok(`${c.n}: sem ícone de origem`, (await el.count()) === 0)
    }
  }
  // Dica na camada máxima ao passar o mouse.
  await p.getByTestId(`pedido-${CASOS[0].numero}`).getByTestId('card-origem').hover()
  await p.waitForTimeout(500)
  const dica = await p.evaluate(() => { const e = [...document.querySelectorAll('body *')].find((x) => x.textContent === 'Origem: Meta – campanha outubro' && x.children.length === 0); if (!e) return null; let z = 0; for (let n = e; n; n = n.parentElement) { const v = Number(getComputedStyle(n).zIndex); if (v > z) z = v } return { z, visivel: e.getBoundingClientRect().width > 0 } })
  ok('dica aparece por cima de tudo (camada máxima)', dica?.visivel && dica.z >= 9999, JSON.stringify(dica))
  await p.mouse.move(5, 5)
  // O card não ganha linha: mesma altura de um pedido Direto igual.
  const hMeta = (await p.getByTestId(`pedido-${CASOS[0].numero}`).boundingBox()).height
  const hDireto = (await p.getByTestId(`pedido-${CASOS[7].numero}`).boundingBox()).height
  ok('card não ganha linha (mesma altura de um Direto)', Math.abs(hMeta - hDireto) <= 1, `${hMeta} × ${hDireto}`)
  const pix = await p.getByTestId(`pedido-${CASOS[0].numero}`).getByTestId('card-pagamento').locator('svg').evaluate((e) => ({ fill: e.getAttribute('fill'), cls: e.getAttribute('class') }))
  ok('pagamento com o ícone antigo (sem o Pix colorido do item 56)', pix.fill !== '#32BCAD', JSON.stringify(pix))
  ok('balcão continua com o selo "PDV" de antes', /PDV/.test(await p.getByTestId(`pedido-${CASOS[8].numero}`).getByTestId('selo-origem').textContent()))
  ok('card de antes: botão de etapa com texto ("Aceitar")', /Aceitar/.test(await p.getByTestId(`pedido-${CASOS[0].numero}`).getByTestId('card-etapa').textContent()))
  if (PRINTS) await p.screenshot({ path: `${PRINTS}/kanban-origem.png` })
  await p.getByTestId(`pedido-${CASOS[0].numero}`).click()
  await p.getByTestId('painel-origem').waitFor({ timeout: 5000 }).catch(() => {})
  ok('painel lateral: "Origem: Meta – campanha outubro"', /Meta – campanha outubro/.test(await p.getByTestId('painel-origem').textContent().catch(() => '')))
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
