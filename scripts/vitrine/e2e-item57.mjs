/**
 * Item 57 (2026-10-06) — ilustrações e acompanhamento do pedido na vitrine nova.
 *   A. Pedidos vazio com ilustração, título, frase e "Ver cardápio".
 *   B. Cupons vazio com ilustração e "Ver cardápio".
 *   C. Detalhes do pedido: ilustração da última atualização ao lado da linha do tempo, trocando sozinha
 *      (recebido → preparando → pronto → saiu → entregue); foto do item com o selo "1x"; sem foto = ícone.
 *   D. Modal "Seu pedido saiu para entrega!": abre ao mudar, "Ver resumo do pedido" abre o detalhe, uma
 *      vez por pedido (não volta ao recarregar), aparece ao abrir a vitrine depois; não em retirada.
 *   E. Retirada pronta e cancelado com a ilustração certa.
 *   F. Vitrine clássica sem mudança (arquivo igual ao main e estado vazio de sempre).
 *   G. 360/390/430 sem rolagem lateral e linha do tempo sem apertar; contraste ≥ 4,5:1 e peso ≤ 600.
 * Banco e servidor LOCAIS. Loja p8-longa com a chave vitrine_nova só durante o teste (volta no fim);
 * cliente e pedidos de teste apagados no fim. Prints em C:\Users\felipe\Downloads\revisao-item57.
 *   node scripts/vitrine/e2e-item57.mjs
 */
import { mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const PRINTS = join(homedir(), 'Downloads', 'revisao-item57'); mkdirSync(PRINTS, { recursive: true })
const SLUG = 'p8-longa', SLUG_CLASSICA = 'ordem-qr-e2e', TEL = '5527990005757'
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (q, a) => (await db.query(q, a)).rows[0]
let falhas = 0, total = 0
const ok = (m, c, d = '') => { total++; console.log(`${c ? '✓' : '✗'} ${m}${c ? '' : ' — ' + d}`); if (!c) falhas++ }
const secao = (t) => console.log(`\n── ${t}`)

const loja = await um(`select id, vitrine_nova vn from restaurantes where slug=$1`, [SLUG])
const classica = await um(`select id, vitrine_nova vn from restaurantes where slug=$1`, [SLUG_CLASSICA])
const itens = (await db.query(`select id, nome, preco from itens_cardapio where restaurante_id=$1 and imagem_url is not null order by posicao nulls last, nome limit 2`, [loja.id])).rows
const limpar = async () => {
  await db.query(`delete from pedidos where restaurante_id in ($1,$2) and cliente_telefone=$3`, [loja.id, classica.id, TEL])
  await db.query(`delete from clientes where restaurante_id in ($1,$2) and telefone=$3`, [loja.id, classica.id, TEL])
}
await limpar()
await db.query(`update restaurantes set vitrine_nova=true where id=$1`, [loja.id])
await db.query(`update restaurantes set vitrine_nova=false where id=$1`, [classica.id])
const cli = await um(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,'TESTE Item 57') returning token`, [loja.id, TEL])
const cliCl = await um(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,'TESTE Item 57') returning token`, [classica.id, TEL])
let numero = 957000
async function novoPedido({ tipo = 'entrega', status = 'recebido', semFoto = false } = {}) {
  const p = await um(`insert into pedidos (restaurante_id, numero, tipo, status, cliente_nome, cliente_telefone, forma_pagamento, subtotal, total, taxa_entrega, endereco_rua, endereco_numero, endereco_bairro)
    values ($1,$2,$3,$4,'TESTE Item 57',$5,'dinheiro',$6,$6,0,'Rua Teste','57','Centro') returning id, numero`, [loja.id, ++numero, tipo, status, TEL, Number(itens[0].preco) + 10])
  await db.query(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade) values ($1,$2,$3,$4,1)`, [p.id, itens[0].id, itens[0].nome, itens[0].preco])
  await db.query(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade) values ($1,null,'TESTE Item sem foto',10,2)`, [p.id])
  return p
}
const status = (id, s) => db.query(`update pedidos set status=$2 where id=$1`, [id, s])

const browser = await chromium.launch()
async function abrir(largura = 390, slug = SLUG, token = cli.token, limparVistos = true) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: largura, height: 844 }, locale: 'pt-BR' })
  await ctx.addInitScript(([s, sess, lv]) => {
    localStorage.setItem(`menuzia_cliente_${s}`, sess)
    if (lv && !sessionStorage.getItem('e2e57')) { localStorage.removeItem(`menuzia_saiu_entrega_vistos_${s}`); sessionStorage.setItem('e2e57', '1') }
  }, [slug, JSON.stringify({ telefone: TEL, token, verificado: true }), limparVistos])
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'networkidle' })
  for (const t of ['Continuar no cardápio', 'Agora não']) await p.getByText(t).first().tap({ timeout: 1200 }).catch(() => {})
  return { ctx, p }
}
const irPara = async (p, nome) => { await p.locator('nav button, nav a').filter({ hasText: nome }).last().tap(); await p.waitForTimeout(900) }
const semLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
/** Textos com contraste < 4,5:1 (3:1 se grande) ou peso > 600 dentro do seletor. */
const auditar = (p, sel) => p.evaluate((sel) => {
  const raiz = document.querySelector(sel); if (!raiz) return { erro: 'sem ' + sel }
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number)
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const fundo = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c } return [255, 255, 255] }
  const ruins = [], pesados = []
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement, t = n.textContent.trim(); if (!el || !t || el.closest('svg, .sr-only, [data-desconto]')) continue
    const r = el.getBoundingClientRect(); if (!r.width) continue
    const cs = getComputedStyle(el); const a = lum(rgb(cs.color)), b = lum(fundo(el)); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
    if (cr < (grande ? 3 : 4.5)) ruins.push(`${t.slice(0, 30)} ${cr.toFixed(2)}`)
    if (Number(cs.fontWeight) > 600) pesados.push(`${t.slice(0, 30)} (${cs.fontWeight})`)
  }
  return { ruins, pesados }
}, sel)
const esperarStatus = async (p, s, ms = 14000) => { try { await p.waitForFunction((s) => document.querySelector('[data-testid="ilustracao-status"]')?.getAttribute('data-status') === s, s, { timeout: ms }); await p.waitForTimeout(500); return true } catch { return false } }

try {
  secao('A. Pedidos vazio')
  {
    const { ctx, p } = await abrir()
    await irPara(p, 'Pedidos')
    const vazio = p.getByTestId('pedidos-vazio')
    ok('ilustração, título e frase', await vazio.isVisible() && (await vazio.locator('img').getAttribute('src')).includes('pedidos-vazio.webp') && (await vazio.innerText()).includes('Você ainda não fez nenhum pedido'))
    const img = await vazio.locator('img').evaluate((e) => ({ w: e.naturalWidth, ok: e.complete && e.naturalWidth > 0 }))
    ok('ilustração carrega (WebP)', img.ok, JSON.stringify(img))
    const aud = await auditar(p, '[data-testid="pedidos-vazio"]'); ok('contraste e peso', !aud.ruins.length && !aud.pesados.length, JSON.stringify(aud))
    await p.screenshot({ path: join(PRINTS, 'pedidos-vazio-390.png') })
    await p.getByTestId('pedidos-vazio-acao').tap(); await p.waitForTimeout(700)
    ok('"Ver cardápio" volta ao cardápio', (await p.getByTestId('pedidos-vazio').count()) === 0)
    await ctx.close()
  }

  secao('B. Cupons vazio')
  {
    const { ctx, p } = await abrir()
    await irPara(p, 'Cupons')
    const vazio = p.getByTestId('cupons-vazio')
    if (await vazio.isVisible().catch(() => false)) {
      ok('ilustração, título e frase', (await vazio.locator('img').getAttribute('src')).includes('cupons-vazio.webp') && (await vazio.innerText()).includes('Nenhum cupom disponível agora'))
      const aud = await auditar(p, '[data-testid="cupons-vazio"]'); ok('contraste e peso', !aud.ruins.length && !aud.pesados.length, JSON.stringify(aud))
      await p.screenshot({ path: join(PRINTS, 'cupons-vazio-390.png') })
      await p.getByTestId('cupons-vazio-acao').tap(); await p.waitForTimeout(700)
      ok('"Ver cardápio" volta ao cardápio', (await p.getByTestId('cupons-vazio').count()) === 0)
    } else ok('loja de teste sem cupons para mostrar o vazio', false, 'a loja tem cupom/campanha')
    await ctx.close()
  }

  secao('C/D. Entrega: ilustração por status, tempo real, foto do item e modal de saída')
  const ped = await novoPedido()
  {
    const { ctx, p } = await abrir()
    await irPara(p, 'Pedidos')
    await p.getByText(`Pedido #${ped.numero}`).first().tap(); await p.waitForTimeout(800)
    ok('recebido: ilustração "recebido" ao lado da linha do tempo', await esperarStatus(p, 'recebido', 3000))
    const lado = await p.evaluate(() => { const i = document.querySelector('[data-testid="ilustracao-status"]').getBoundingClientRect(); const t = document.querySelector('[data-testid="detalhe-acompanhamento"] > div').getBoundingClientRect(); return { ilusEsq: i.left, tlDir: t.right, tlLarg: t.width, ilusLarg: i.width } })
    ok('ilustração no canto direito, sem apertar a linha do tempo', lado.ilusEsq >= lado.tlDir && lado.tlLarg >= 190, JSON.stringify(lado))
    const fotos = await p.locator('[data-testid="foto-item-pedido"]').evaluateAll((els) => els.map((e) => [e.dataset.temFoto, e.querySelector('[data-testid="foto-item-qtd"]').textContent]))
    ok('foto do item com selo "1x"; item sem foto com ícone e "2x"', JSON.stringify(fotos) === JSON.stringify([['sim', '1x'], ['nao', '2x']]), JSON.stringify(fotos))
    await p.screenshot({ path: join(PRINTS, 'detalhe-1-recebido-390.png') })
    const aud = await auditar(p, '[data-testid="detalhe-acompanhamento"]'); ok('linha do tempo: contraste e peso', !aud.ruins.length && !aud.pesados.length, JSON.stringify(aud))
    for (const [s, k, n] of [['preparando', 'preparando', 2], ['pronto', 'pronto', 3]]) {
      await status(ped.id, s)
      ok(`troca sozinha para "${k}" (tempo real)`, await esperarStatus(p, k))
      if (k === 'pronto') { const a2 = await auditar(p, '[data-testid="detalhe-acompanhamento"]'); ok('etapas concluídas: contraste e peso', !a2.ruins.length && !a2.pesados.length, JSON.stringify(a2)) }
      await p.screenshot({ path: join(PRINTS, `detalhe-${n}-${k}-390.png`) })
    }
    await status(ped.id, 'em_rota')
    const modal = p.getByTestId('modal-saiu-entrega')
    let abriu = false; try { await modal.waitFor({ timeout: 14000 }); abriu = true } catch { /* */ }
    ok('saiu para entrega: modal central aparece sozinho', abriu)
    if (abriu) {
      const m = await modal.evaluate((e) => { const r = e.getBoundingClientRect(); const z = getComputedStyle(e.closest('[data-modal-central]')).zIndex; return { centro: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2, z, noBody: !!e.closest('[data-modal-central]') && e.closest('[data-modal-central]').parentElement === document.body, texto: e.innerText, img: e.querySelector('img').getAttribute('src') } })
      ok('modal no centro, no <body>, camada máxima', m.centro && m.noBody && m.z === '9999', JSON.stringify(m))
      ok('modal: ilustração do motoboy, título e número do pedido', m.img.includes('saiu-para-entrega.webp') && m.texto.includes('Seu pedido saiu para entrega!') && m.texto.includes(`#${ped.numero}`), m.texto)
      const audM = await auditar(p, '[data-testid="modal-saiu-entrega"]'); ok('modal: contraste e peso', !audM.ruins.length && !audM.pesados.length, JSON.stringify(audM))
      const fonte = await modal.locator('h2').evaluate((e) => getComputedStyle(e).fontFamily)
      ok('modal com a fonte da vitrine', /figtree|montserrat|vitrine|meta/i.test(fonte), fonte)
      await p.screenshot({ path: join(PRINTS, 'modal-saiu-entrega-390.png') })
      await p.getByTestId('modal-saiu-entrega-resumo').tap(); await p.waitForTimeout(700)
      ok('"Ver resumo do pedido" fecha o modal e mostra o detalhe', (await modal.count()) === 0 && await p.getByText('Detalhes do pedido').first().isVisible())
    }
    ok('saiu para entrega: ilustração do motoboy no detalhe', await esperarStatus(p, 'em_rota', 4000))
    await p.screenshot({ path: join(PRINTS, 'detalhe-4-saiu-390.png') })
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
    ok('uma vez por pedido: não volta ao recarregar', (await p.getByTestId('modal-saiu-entrega').count()) === 0)
    await irPara(p, 'Pedidos')
    await p.getByText(`Pedido #${ped.numero}`).first().tap(); await p.waitForTimeout(600)
    await status(ped.id, 'entregue')
    ok('entregue: ilustração "entregue"', await esperarStatus(p, 'entregue'))
    await p.screenshot({ path: join(PRINTS, 'detalhe-5-entregue-390.png') })
    await ctx.close()
  }
  {
    // Saiu com a vitrine fechada: o aviso aparece ao abrir.
    const ped2 = await novoPedido({ status: 'em_rota' })
    const { ctx, p } = await abrir(390, SLUG, cli.token, true)
    let abriu = false; try { await p.getByTestId('modal-saiu-entrega').waitFor({ timeout: 8000 }); abriu = true } catch { /* */ }
    ok('saiu com a vitrine fechada: aviso aparece ao abrir', abriu)
    if (abriu) {
      ok('…com o número desse pedido', (await p.getByTestId('modal-saiu-entrega').innerText()).includes(`#${ped2.numero}`))
      await p.getByTestId('modal-saiu-entrega-fechar').tap(); await p.waitForTimeout(500)
      ok('fechar (X) fecha o modal', (await p.getByTestId('modal-saiu-entrega').count()) === 0)
    }
    await status(ped2.id, 'entregue')
    await ctx.close()
  }

  secao('E. Retirada e cancelado')
  {
    const ret = await novoPedido({ tipo: 'retirada', status: 'pronto' })
    const can = await novoPedido({ status: 'cancelado' })
    const { ctx, p } = await abrir()
    await p.waitForTimeout(2500)
    ok('retirada: nenhum modal de saída', (await p.getByTestId('modal-saiu-entrega').count()) === 0)
    await irPara(p, 'Pedidos')
    await p.getByText(`Pedido #${ret.numero}`).first().tap(); await p.waitForTimeout(700)
    ok('retirada pronta: ilustração "retirada"', await esperarStatus(p, 'retirada', 3000))
    await p.screenshot({ path: join(PRINTS, 'detalhe-retirada-pronta-390.png') })
    await p.getByText('Detalhes do pedido').first().locator('xpath=..').locator('button').first().tap(); await p.waitForTimeout(500)
    await p.getByText(`Pedido #${can.numero}`).first().tap(); await p.waitForTimeout(700)
    ok('cancelado: ilustração "cancelado"', await esperarStatus(p, 'cancelado', 3000))
    await p.screenshot({ path: join(PRINTS, 'detalhe-cancelado-390.png') })
    await ctx.close()
  }

  secao('F. Vitrine clássica sem mudança')
  {
    const doMain = execSync('git show origin/main:"app/loja/[slug]/vitrine-classica.tsx"', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, '\n')
    ok('vitrine-classica.tsx igual ao main', doMain === readFileSync('app/loja/[slug]/vitrine-classica.tsx', 'utf8').replace(/\r\n/g, '\n'))
    const { ctx, p } = await abrir(390, SLUG_CLASSICA, cliCl.token)
    await irPara(p, 'Pedidos')
    ok('clássica: estado vazio de sempre (sem a ilustração nova)', (await p.getByTestId('pedidos-vazio').count()) === 0 && await p.getByText('Nenhum pedido ainda').first().isVisible())
    await p.screenshot({ path: join(PRINTS, 'classica-pedidos-vazio-390.png') })
    await ctx.close()
  }

  secao('G. Larguras')
  {
    const ped3 = await novoPedido({ status: 'preparando' })
    for (const w of [360, 390, 430]) {
      const { ctx, p } = await abrir(w)
      await irPara(p, 'Pedidos')
      await p.getByText(`Pedido #${ped3.numero}`).first().tap(); await p.waitForTimeout(800)
      const m = await p.evaluate(() => { const t = document.querySelector('[data-testid="detalhe-acompanhamento"] > div').getBoundingClientRect(); const lin = [...document.querySelectorAll('[data-testid="detalhe-acompanhamento"] .text-\\[13px\\]')].map((e) => e.getBoundingClientRect().height); return { tl: Math.round(t.width), maxAltLinha: Math.max(...lin) } })
      ok(`${w}px: sem rolagem lateral, linha do tempo ≥ 180px e etapas numa linha só`, await semLateral(p) && m.tl >= 180 && m.maxAltLinha <= 22, JSON.stringify(m))
      await p.screenshot({ path: join(PRINTS, `detalhe-preparando-${w}.png`) })
      await ctx.close()
    }
  }
} finally {
  await limpar()
  await db.query(`update restaurantes set vitrine_nova=$2 where id=$1`, [loja.id, loja.vn])
  await db.query(`update restaurantes set vitrine_nova=$2 where id=$1`, [classica.id, classica.vn])
  await browser.close(); await db.end()
  console.log(`\n${total - falhas}/${total} verificações passaram`)
  process.exitCode = falhas ? 1 : 0
}
