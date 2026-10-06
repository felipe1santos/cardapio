/**
 * E2E — vitrine no padrão iFood (pendência 9, 2026-10-06). Só stack LOCAL.
 *   A. Ajustes › Apresentação: sem Gaveta (loja em gaveta aparece em Lista), tamanho da imagem
 *      90/100/110 com prévia, fonte Atual/Estilo iFood — grava no banco.
 *   B. Vitrine: lado da foto da lista e fonte Figtree com peso até 600.
 *   C. Sacola: topo (voltar, SACOLA, Limpar), loja + Adicionar mais itens, linha com lápis,
 *      lixeira no 1 e − 1 +, preço riscado, Peça também, cupom aplicado com 1 toque, resumo
 *      com descontos em verde, barra fixa com economia, Limpar com confirmação.
 *   D. Checkout: Entrega → Pagamento → "Revise o seu pedido" (Alterar volta), retirada.
 *   E. Pix online (MP simulado): "Pagar agora" só com a flag; pedido abre a tela do Pix.
 *   F. Contraste ≥ 4,5:1 e peso ≤ 600 na sacola, checkout, revisão e ficha.
 *   G. 360/390/430 sem rolagem lateral; tablet e desktop.
 *   H. Chave por loja (vitrine_nova, 07/10): sem ela, a loja segue com a vitrine/checkout de sempre —
 *      vitrine-classica.tsx igual ao main, selo de desconto e checkout antigos, sem fonte iFood.
 * O teste liga a chave só nas lojas que usa (p8-longa, fin-int, cantina-demo) e devolve no fim.
 * Limpa o que cria e devolve as configurações das lojas.
 *
 *   MP_SIMULADO_ARQUIVO=… node scripts/vitrine-p9/e2e-vitrine-p9.mjs [pasta-de-prints]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'
import { USU } from '../seguranca/e2e-ambiente.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'p8-longa'
const SLUG_PIX = 'fin-int'
const PRINTS = process.argv[2] ?? 'docs/vitrine-p9/e2e'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (q, a = []) => (await db.query(q, a)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)

const loja = await um(`select id, vitrine_imagem_tamanho t, vitrine_fonte f, aceita_entrega e, aceita_retirada r, vitrine_nova vn from restaurantes where slug=$1`, [SLUG])
const lojaPix = await um(`select id, pix_online_ativo, vitrine_nova vn from restaurantes where slug=$1`, [SLUG_PIX])
const demo = await um(`select id, layout_cardapio l, vitrine_imagem_tamanho t, vitrine_fonte f, vitrine_nova vn from restaurantes where slug='cantina-demo'`)
// Loja de controle, SEM a chave: tem de ver a vitrine de sempre.
const SLUG_CLASSICA = 'ordem-qr-e2e'
const classica = await um(`select id, vitrine_nova vn from restaurantes where slug=$1`, [SLUG_CLASSICA])
await db.query(`update restaurantes set vitrine_nova=true where id = any($1)`, [[loja.id, lojaPix.id, demo.id]])
await db.query(`update restaurantes set vitrine_nova=false where id=$1`, [classica.id])
const TEL = '27999880099'
const TEL_PIX = '27999880098'
const criadosCupom = []
const criadosBump = []

/** Contraste WCAG entre duas cores rgb()/rgba(). */
function contraste(c1, c2) {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [a, b] = [lum(c1), lum(c2)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/** Lista textos visíveis com peso > 600 ou contraste < 4,5 dentro de `raiz`. */
async function auditar(p, raiz) {
  const itens = await p.evaluate((sel) => {
    const base = document.querySelector(sel)
    if (!base) return { erro: 'sem ' + sel }
    const fundoDe = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null // foto/gradiente: não mede
        const m = cs.backgroundColor.match(/[\d.]+/g)
        if (m && (m.length < 4 || Number(m[3]) > 0.9)) return cs.backgroundColor
      }
      return 'rgb(255, 255, 255)'
    }
    const out = []
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim()
      if (!t) continue
      const el = n.parentElement
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) continue
      if (el.closest('button:disabled, [aria-hidden="true"], [data-ignorar-auditoria]')) continue
      out.push({ t: t.slice(0, 40), peso: Number(cs.fontWeight), cor: cs.color, fundo: fundoDe(el), riscado: cs.textDecorationLine.includes('line-through') })
    }
    return out
  }, raiz)
  if (itens.erro) return { pesados: [itens.erro], baixos: [] }
  const pesados = itens.filter((i) => i.peso > 600).map((i) => `${i.t} (${i.peso})`)
  const baixos = itens.filter((i) => i.fundo && contraste(i.cor, i.fundo) < 4.5).map((i) => `${i.t} ${i.cor}/${i.fundo} ${contraste(i.cor, i.fundo).toFixed(2)}`)
  return { pesados, baixos, total: itens.length }
}

async function semRolagemLateral(p) {
  return p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}

const browser = await chromium.launch()
const novoCelular = async (largura = 390) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: largura, height: 844 }, locale: 'pt-BR' })
  return { ctx, p: await ctx.newPage() }
}
async function entrarComTelefone(p, tel) {
  const campo = p.locator('[data-testid="janela-conta"]').getByPlaceholder('(00) 00000-0000')
  await campo.waitFor({ timeout: 8000 })
  await campo.fill(tel)
  await p.locator('[data-testid="janela-conta"] button').filter({ hasText: /^Continuar$/i }).tap()
  await p.waitForTimeout(1300)
}
// Modais de prêmio/boas-vindas que a vitrine abre sozinha (há cupom público na loja de teste).
async function fecharModaisVitrine(p) {
  for (const alvo of [p.getByText('Continuar no cardápio'), p.getByText('Agora não'), p.locator('button[aria-label="Fechar"]')]) {
    if (await alvo.first().isVisible().catch(() => false)) { await alvo.first().click().catch(() => {}); await p.waitForTimeout(300) }
  }
}
const barra = (p, re) => p.locator('[data-barra-checkout] button').filter({ hasText: re }).first()

try {
  // ─────────────────────────────────────────────────────────────────────────
  secao('A. Ajustes › Apresentação do cardápio')
  await db.query(`update restaurantes set layout_cardapio='gaveta', vitrine_imagem_tamanho=null, vitrine_fonte='atual' where id=$1`, [demo.id])
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`)
    await p.fill('input[name="email"]', USU.dono)
    await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
    await p.getByText('Apresentação do cardápio').first().scrollIntoViewIfNeeded().catch(() => {})
    const abrir = p.getByRole('button', { name: /Apresentação|Cardápio/ }).first()
    if (!(await p.getByTestId('formato-cardapio').isVisible().catch(() => false))) await abrir.click().catch(() => {})
    await p.getByTestId('formato-cardapio').waitFor({ timeout: 15000 })
    // O checklist de configuração (modal do dono) abre por cima depois de uns segundos: fecha.
    const fecharAviso = async () => { const m = p.locator('[aria-labelledby="setup-alerta-titulo"]').first(); if (await m.isVisible().catch(() => false)) { await m.getByRole('button', { name: 'OK' }).first().click().catch(() => m.click({ position: { x: 5, y: 5 } }).catch(() => {})); await p.waitForTimeout(300) } }
    await p.waitForTimeout(2500); await fecharAviso()
    ok('Formato: só Categorias e Lista (Gaveta saiu)', (await p.getByTestId('formato-cardapio').locator('button').count()) === 2 && (await p.getByText('Gaveta', { exact: true }).count()) === 0)
    ok('loja em gaveta aparece em Lista', (await p.getByTestId('formato-cardapio').locator('[aria-pressed="true"]').textContent()).includes('Lista'))
    ok('sem o aviso de fotos por categoria', (await p.getByText(/precisa de uma foto em cada categoria/).count()) === 0)
    ok('tamanho: 90, 100 e 110; sem escolha mostra o tamanho de antes', (await p.getByTestId('imagem-tamanho').locator('button').count()) === 3 && await p.getByTestId('imagem-tamanho-antigo').isVisible())
    await fecharAviso()
    await p.getByTestId('imagem-tamanho-100').click()
    const prev = await p.getByTestId('previa-foto').boundingBox()
    ok('prévia mostra a foto em 100×100', prev && Math.round(prev.width) === 100 && Math.round(prev.height) === 100, JSON.stringify(prev))
    await p.getByTestId('fonte-ifood').click()
    const famPrev = await p.getByTestId('previa-linha-item').locator('div').nth(1).evaluate((e) => getComputedStyle(e).fontFamily)
    ok('prévia usa a fonte Estilo iFood (Figtree)', /figtree|__font_meta|Figtree/i.test(famPrev) || famPrev.includes('meta'), famPrev)
    await p.getByTestId('previa-linha-item').screenshot({ path: join(PRINTS, 'ajustes-previa.png') }).catch(() => {})
    await p.getByTestId('formato-cardapio').scrollIntoViewIfNeeded()
    await p.screenshot({ path: join(PRINTS, 'ajustes-apresentacao.png'), fullPage: false })
    await fecharAviso()
    await p.getByRole('button', { name: /^Salvar/ }).last().click()
    await p.waitForTimeout(1500)
    const d = await um(`select layout_cardapio l, vitrine_imagem_tamanho t, vitrine_fonte f from restaurantes where id=$1`, [demo.id])
    ok('salvar grava lista, 100 e ifood', d.l === 'lista' && d.t === 100 && d.f === 'ifood', JSON.stringify(d))
    await ctx.close()
  }

  // ─────────────────────────────────────────────────────────────────────────
  secao('B. Vitrine: tamanho da imagem e fonte')
  for (const t of [90, 110]) {
    await db.query(`update restaurantes set vitrine_imagem_tamanho=$2 where id=$1`, [loja.id, t])
    const { ctx, p } = await novoCelular()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    const caixa = await p.locator('button[data-item-id]').nth(3).locator('div.relative.flex-shrink-0').first().boundingBox()
    ok(`lista com foto de ${t}×${t}`, caixa && Math.round(caixa.width) === t, JSON.stringify(caixa))
    await p.screenshot({ path: join(PRINTS, `lista-${t}.png`) })
    await ctx.close()
  }
  await db.query(`update restaurantes set vitrine_fonte='ifood' where id=$1`, [loja.id])
  {
    const { ctx, p } = await novoCelular()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    const fam = await p.locator('button[data-item-id]').first().evaluate((e) => getComputedStyle(e).fontFamily)
    ok('fonte Estilo iFood: Figtree na vitrine', /figtree|meta/i.test(fam), fam)
    const pesos = await p.evaluate(() => [...document.querySelectorAll('.font-loja *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getBoundingClientRect().width).map((e) => Number(getComputedStyle(e).fontWeight)))
    ok('fonte Estilo iFood: nenhum texto acima de 600', pesos.every((w) => w <= 600), String(Math.max(...pesos)))
    await p.screenshot({ path: join(PRINTS, 'home-fonte-ifood-390.png') })
    await ctx.close()
  }
  await db.query(`update restaurantes set vitrine_fonte='atual', vitrine_imagem_tamanho=null where id=$1`, [loja.id])
  {
    const { ctx, p } = await novoCelular()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    const fam = await p.locator('button[data-item-id]').first().evaluate((e) => getComputedStyle(e).fontFamily)
    const caixa = await p.locator('button[data-item-id]').nth(3).locator('div.relative.flex-shrink-0').first().boundingBox()
    ok('fonte Atual: Montserrat; sem escolha de tamanho a foto continua 120', /montserrat|vitrine/i.test(fam) && Math.round(caixa?.width ?? 0) === 120, `${fam} ${caixa?.width}`)
    await ctx.close()
  }

  // ─────────────────────────────────────────────────────────────────────────
  secao('C. Sacola')
  await db.query(`update restaurantes set aceita_entrega=true, aceita_retirada=true where id=$1`, [loja.id])
  const itens = (await db.query(`select id, nome from itens_cardapio where restaurante_id=$1 and status='disponivel' order by nome`, [loja.id])).rows
  const promo = await um(`select id, nome from itens_cardapio where restaurante_id=$1 and promocao_preco is not null and status='disponivel' limit 1`, [loja.id])
  for (const [i, it] of itens.slice(-2).entries()) {
    const b = await um(`insert into order_bumps (restaurante_id, item_id, posicao, ativo) values ($1,$2,$3,true) returning id`, [loja.id, it.id, 90 + i])
    criadosBump.push(b.id)
  }
  const cup = await um(`insert into cupons (restaurante_id, codigo, ativo, tipo, valor, publico) values ($1,'P9SACOLA',true,'desconto_percentual',10,'todos') returning id`, [loja.id])
  criadosCupom.push(cup.id)
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  {
    const { ctx, p } = await novoCelular()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle' })
    // Com o cupom público a vitrine abre o modal de boas-vindas: segue no cardápio.
    await p.getByText('Continuar no cardápio').first().tap({ timeout: 4000 }).catch(() => {})
    await p.waitForTimeout(400)
    await p.locator(`button[data-item-id="${promo.id}"]`).last().tap()
    await p.waitForTimeout(600)
    const fichaAud = await auditar(p, '[data-testid="ficha-produto"]')
    await p.screenshot({ path: join(PRINTS, 'ficha-390.png') })
    await p.getByRole('button', { name: /Adicionar/ }).last().tap()
    await p.waitForTimeout(600)
    await p.getByText('Ver sacola').first().tap()
    await p.waitForTimeout(800)
    // Entra com o telefone pelo "Continuar" e volta à sacola, para os cupons do cliente aparecerem.
    await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
    await entrarComTelefone(p, TEL)
    ok('Continuar da sacola abre a ENTREGA primeiro', (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'entrega')
    await fecharModaisVitrine(p)
    await p.getByRole('button', { name: 'Voltar' }).first().tap()
    await p.waitForTimeout(800)
    const topo = p.getByTestId('topo-sacola')
    ok('topo: voltar, SACOLA e Limpar', (await topo.getByRole('button', { name: /Voltar/ }).count()) === 1 && /sacola/i.test(await topo.locator('h1').textContent()) && await p.getByTestId('limpar-sacola').isVisible())
    ok('loja com logo e "Adicionar mais itens"', await p.getByTestId('sacola-loja').isVisible() && await p.getByTestId('adicionar-mais-itens').isVisible())
    const linha = p.locator('[data-linha-sacola]').first()
    ok('linha: foto, lápis, lixeira no 1 e +', (await linha.locator('img, svg').count()) >= 1 && (await linha.locator('[data-editar-linha]').count()) === 1 && (await linha.locator('[data-acao="remover"]').count()) === 1 && (await linha.locator('[data-acao="mais"]').count()) === 1)
    ok('linha: preço antigo riscado', await linha.locator('[data-preco-antigo]').evaluate((e) => getComputedStyle(e).textDecorationLine.includes('line-through')))
    await linha.locator('[data-acao="mais"]').tap()
    ok('+ sobe para 2 e a lixeira vira −', (await linha.locator('[data-qtd]').textContent()) === '2' && (await linha.locator('[data-acao="menos"]').count()) === 1)
    ok('"Peça também" com foto, preço e +', await p.getByTestId('peca-tambem').isVisible() && (await p.locator('[data-bump]').count()) >= 1)
    const antesBump = await p.locator('[data-linha-sacola]').count()
    await p.locator('[data-bump] button').first().tap()
    await p.waitForTimeout(500)
    ok('+ do "Peça também" põe o item na sacola', (await p.locator('[data-linha-sacola]').count()) === antesBump + 1)
    ok('resumo: descontos dos itens em verde', await p.getByTestId('linha-desconto-itens').evaluate((e) => getComputedStyle(e).color === 'rgb(11, 122, 62)'))
    const econAntes = await p.getByTestId('barra-sacola-continuar').locator('[data-economia]').textContent()
    ok('barra fixa: total, itens, economia e Continuar', /Economia de R\$/.test(econAntes) && /Continuar/.test(await p.getByTestId('barra-sacola-continuar').textContent()))
    const cupons = p.getByTestId('cupons-sacola')
    ok('cupons disponíveis na sacola', await cupons.isVisible().catch(() => false) && (await cupons.getByText('P9SACOLA').count()) === 1)
    await cupons.locator('[data-cupom-sacola="cupom"]').filter({ hasText: 'P9SACOLA' }).getByTestId('cupom-sacola-aplicar').tap()
    await p.waitForTimeout(1500)
    await p.getByText(/Continuar|Ver sacola|Fechar/).last().tap({ timeout: 1500 }).catch(() => {})
    await p.waitForTimeout(800)
    const linhaCupom = p.getByTestId('linha-desconto-cupom')
    ok('cupom aplicado com 1 toque: linha verde "Cupom P9SACOLA"', await linhaCupom.isVisible().catch(() => false) && (await linhaCupom.textContent()).includes('P9SACOLA'))
    const econDepois = await p.getByTestId('barra-sacola-continuar').locator('[data-economia]').textContent()
    const valor = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'))
    ok('economia soma o cupom', valor(econDepois) > valor(econAntes), `${econAntes} → ${econDepois}`)
    const audSacola = [await auditar(p, '[data-testid="sacola"]'), await auditar(p, '[data-testid="topo-sacola"]'), await auditar(p, '[data-testid="barra-sacola-continuar"]')]
      .reduce((a, b) => ({ pesados: [...a.pesados, ...b.pesados], baixos: [...a.baixos, ...b.baixos] }))
    await p.screenshot({ path: join(PRINTS, 'sacola-390.png') })
    await p.screenshot({ path: join(PRINTS, 'sacola-390-inteira.png'), fullPage: true })
    ok('ficha: peso ≤ 600 e contraste ≥ 4,5', fichaAud.pesados.length === 0 && fichaAud.baixos.length === 0, JSON.stringify(fichaAud))
    ok('sacola: peso ≤ 600 e contraste ≥ 4,5', audSacola.pesados.length === 0 && audSacola.baixos.length === 0, JSON.stringify(audSacola))

    // ── D. Checkout
    secao('D. Checkout: Entrega → Pagamento → Revise')
    await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
    await p.waitForTimeout(1000)
    ok('Entrega: opções Padrão (prazo) e Retirar na loja + atalho', await p.getByTestId('opcao-entrega-padrao').isVisible() && /30–45 min/.test(await p.getByTestId('opcao-entrega-padrao').textContent()) && await p.getByTestId('opcao-retirada').isVisible() && await p.getByTestId('atalho-retirada').isVisible())
    await p.getByPlaceholder('Seu nome').fill('Cliente P9')
    await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro')
    await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
    await p.getByPlaceholder('123').fill('10')
    await p.waitForTimeout(1200)
    const audEntrega = await auditar(p, '[data-testid="checkout"]')
    await p.screenshot({ path: join(PRINTS, 'entrega-390.png') })
    await barra(p, /^Continuar$/).tap()
    await p.waitForTimeout(800)
    ok('depois da Entrega vem o Pagamento', (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'pagamento')
    ok('sem a flag do Pix online: não há "Pagar agora"', (await p.getByTestId('pagar-agora').count()) === 0 && await p.getByTestId('pagar-na-entrega').isVisible())
    await p.getByTestId('pagamento-cartao').tap()
    const audPag = await auditar(p, '[data-testid="checkout"]')
    await p.screenshot({ path: join(PRINTS, 'pagamento-390.png') })
    await barra(p, /Revisar pedido/).tap()
    await p.waitForTimeout(800)
    const rev = p.getByTestId('revise-pedido')
    ok('"Revise o seu pedido": entrega, pagamento, itens, dados, total', await rev.isVisible() && /Rua Teste, 10/.test(await p.getByTestId('revise-entrega').textContent()) && /Cartão/.test(await p.getByTestId('revise-pagamento').textContent()) && /itens/.test(await p.getByTestId('revise-itens').textContent()) && /Cliente P9/.test(await p.getByTestId('revise-dados').textContent()))
    const caixaFazer = await p.getByTestId('fazer-pedido').boundingBox()
    ok('"Fazer pedido" no fim da tela e por cima de tudo', caixaFazer && caixaFazer.y + caixaFazer.height <= 844 && await p.getByTestId('fazer-pedido').evaluate((b) => { const r = b.getBoundingClientRect(); const a = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b === a || b.contains(a) }))
    const audRev = await auditar(p, '[data-testid="revise-pedido"]')
    await p.screenshot({ path: join(PRINTS, 'revise-390.png') })
    await p.getByTestId('alterar-pedido').tap()
    await p.waitForTimeout(500)
    ok('"Alterar pedido" volta ao pagamento', (await rev.count()) === 0 && (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'pagamento')
    ok('entrega/pagamento/revisão: peso ≤ 600 e contraste ≥ 4,5', [audEntrega, audPag, audRev].every((a) => a.pesados.length === 0 && a.baixos.length === 0), JSON.stringify({ audEntrega, audPag, audRev }))
    await barra(p, /Revisar pedido/).tap()
    await p.waitForTimeout(600)
    const espera = p.waitForResponse((r) => r.url().endsWith(`/api/loja/${SLUG}/pedido`) && r.request().method() === 'POST', { timeout: 15000 })
    await p.getByTestId('fazer-pedido').tap()
    const resp = await espera.catch(() => null)
    const j = resp ? await resp.json().catch(() => null) : null
    const ped = j?.id ? await um(`select tipo, forma_pagamento, cupom_codigo, desconto, total from pedidos where id=$1`, [j.id]) : null
    ok('pedido gravado: entrega, cartão, cupom P9SACOLA com desconto', ped?.tipo === 'entrega' && ped?.forma_pagamento === 'cartao' && ped?.cupom_codigo === 'P9SACOLA' && Number(ped?.desconto) > 0, JSON.stringify(ped))
    await ctx.close()
  }
  // Limpar e retirada
  {
    const { ctx, p } = await novoCelular(360)
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.getByText('Continuar no cardápio').first().click({ timeout: 3000 }).catch(() => {})
    await p.locator('button[data-item-id]').first().tap(); await p.waitForTimeout(500)
    await p.getByRole('button', { name: /Adicionar/ }).last().tap(); await p.waitForTimeout(500)
    await p.getByText('Ver sacola').first().tap(); await p.waitForTimeout(600)
    await p.getByTestId('limpar-sacola').tap()
    ok('Limpar pede confirmação', await p.getByTestId('confirmar-limpar').isVisible())
    await p.getByTestId('confirmar-limpar-sim').tap()
    await p.waitForTimeout(400)
    ok('confirmado, a sacola fica vazia', (await p.locator('[data-linha-sacola]').count()) === 0 && (await p.getByText('Sua sacola está vazia').count()) === 1)
    await ctx.close()
  }

  // ─────────────────────────────────────────────────────────────────────────
  secao('E. Pix online (Mercado Pago SIMULADO)')
  if (!process.env.MP_SIMULADO_ARQUIVO) ok('MP_SIMULADO_ARQUIVO definido', false)
  else {
    await db.query(`update restaurantes set pix_online_ativo=true where id=$1`, [lojaPix.id])
    const { ctx, p } = await novoCelular()
    try {
      const item = await um(`select nome from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 order by preco limit 1`, [lojaPix.id])
      await p.goto(`${BASE}/loja/${SLUG_PIX}`, { waitUntil: 'networkidle' })
      await p.locator('button:has-text("R$")', { hasText: item.nome }).first().tap()
      await p.getByRole('button', { name: /Adicionar/ }).last().tap(); await p.waitForTimeout(500)
      await p.getByText('Ver sacola').first().tap()
      await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
      if (await p.locator('[data-testid="janela-conta"]').isVisible({ timeout: 2500 }).catch(() => false)) await entrarComTelefone(p, TEL_PIX)
      if (await p.getByTestId('opcao-retirada').isVisible().catch(() => false)) await p.getByTestId('opcao-retirada').tap()
      await p.getByPlaceholder('Seu nome').fill('Cliente Pix P9')
      if (await p.getByPlaceholder('Nome da rua').isVisible().catch(() => false)) {
        await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro')
        await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
        await p.getByPlaceholder('123').fill('10')
        await p.waitForTimeout(1000)
      }
      await barra(p, /^Continuar$/).tap()
      await p.waitForTimeout(800)
      ok('com a flag: grupo "Pagar agora" com o Pix online', await p.getByTestId('pagar-agora').isVisible() && await p.getByTestId('pagamento-pix-online').isVisible())
      ok('e o Pix sai de "Pagar na entrega"', (await p.getByTestId('pagamento-pix').count()) === 0)
      await p.getByTestId('pagamento-pix-online').tap()
      await p.screenshot({ path: join(PRINTS, 'pagamento-pix-online-390.png') })
      await barra(p, /Revisar pedido/).tap()
      await p.waitForTimeout(600)
      ok('revisão diz "Pagar agora · Pix online"', /Pagar agora · Pix online/.test(await p.getByTestId('revise-pagamento').textContent()))
      await p.getByTestId('fazer-pedido').tap()
      await p.getByTestId('tela-pix-online').waitFor({ timeout: 15000 })
      ok('Fazer pedido abre a tela do Pix (QR do MP simulado)', true)
      const pp = await um(`select p.id, p.status, po.mp_payment_id from pedidos p join pagamentos_online po on po.pedido_id=p.id where p.restaurante_id=$1 order by p.criado_em desc limit 1`, [lojaPix.id])
      ok('pedido aguardando pagamento com cobrança', pp?.status === 'aguardando_pagamento', JSON.stringify(pp))
      const e = JSON.parse(readFileSync(process.env.MP_SIMULADO_ARQUIVO, 'utf8')); e.pagamentos[pp.mp_payment_id].status = 'approved'; writeFileSync(process.env.MP_SIMULADO_ARQUIVO, JSON.stringify(e, null, 1))
      await p.getByTestId('pix-pago').waitFor({ timeout: 25000 })
      ok('pagamento aprovado no simulado: tela confirma', true)
      await p.screenshot({ path: join(PRINTS, 'pix-pago-390.png') })
      await db.query(`delete from pedidos where id=$1`, [pp.id]).catch(() => {})
    } catch (err) {
      ok('fluxo do Pix online', false, String(err).slice(0, 200))
    } finally {
      await db.query(`update restaurantes set pix_online_ativo=$2 where id=$1`, [lojaPix.id, lojaPix.pix_online_ativo])
      await ctx.close()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  secao('H. Outras lojas (sem a chave): a vitrine de sempre')
  {
    const { execSync } = await import('node:child_process')
    const { readFileSync } = await import('node:fs')
    const doMain = execSync('git show origin/main:"app/loja/[slug]/vitrine.tsx"', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\r\n/g, '\n')
    const classicaArq = readFileSync('app/loja/[slug]/vitrine-classica.tsx', 'utf8').replace(/\r\n/g, '\n')
    ok('vitrine-classica.tsx é igual à vitrine do main (byte a byte)', doMain === classicaArq, `${doMain.length} × ${classicaArq.length}`)
    const { ctx, p } = await novoCelular()
    await p.goto(`${BASE}/loja/${SLUG_CLASSICA}`, { waitUntil: 'networkidle' })
    await p.getByText('Continuar no cardápio').first().tap({ timeout: 3000 }).catch(() => {})
    const raiz = await p.evaluate(() => { const r = document.querySelector('.font-loja'); return { ifood: r?.classList.contains('vitrine-fonte-ifood') ?? null, fam: r ? getComputedStyle(r).fontFamily : null } })
    ok('sem a chave: fonte de sempre (Montserrat), sem a classe iFood', raiz.ifood === false && /montserrat|vitrine/i.test(raiz.fam ?? ''), JSON.stringify(raiz))
    const pil = await p.locator('[data-desconto]').first().evaluate((e) => ({ b: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color, svg: e.querySelectorAll('svg').length })).catch(() => null)
    ok('sem a chave: selo de desconto de sempre (verde-claro com o ticket)', !!pil && pil.b === 'rgb(234, 255, 245)' && pil.c === 'rgb(36, 169, 106)' && pil.svg === 1, JSON.stringify(pil))
    await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
    await p.getByRole('button', { name: /Adicionar/ }).last().tap(); await p.waitForTimeout(600)
    await p.getByText('Ver sacola').first().tap(); await p.waitForTimeout(700)
    ok('sem a chave: sacola de sempre (sem o topo SACOLA/Limpar, com "Continuar para pagamento")', (await p.getByTestId('topo-sacola').count()) === 0 && (await p.getByRole('button', { name: /Continuar para pagamento/ }).count()) >= 1)
    await p.screenshot({ path: join(PRINTS, 'outra-loja-sacola-de-sempre.png') })
    await ctx.close()
  }

  secao('G. Larguras, tablet e desktop')
  for (const largura of [360, 390, 430]) {
    const { ctx, p } = await novoCelular(largura)
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.getByText('Continuar no cardápio').first().click({ timeout: 3000 }).catch(() => {})
    await p.locator('button[data-item-id]').first().tap(); await p.waitForTimeout(500)
    await p.getByRole('button', { name: /Adicionar/ }).last().tap(); await p.waitForTimeout(500)
    await p.getByText('Ver sacola').first().tap(); await p.waitForTimeout(600)
    const s1 = await semRolagemLateral(p)
    await p.screenshot({ path: join(PRINTS, `sacola-${largura}.png`) })
    await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
    await entrarComTelefone(p, TEL)
    const s2 = await semRolagemLateral(p)
    ok(`${largura}px: sacola e checkout sem rolagem lateral`, s1 && s2)
    await ctx.close()
  }
  for (const [nome, vp] of [['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1366, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.getByText('Continuar no cardápio').first().click({ timeout: 3000 }).catch(() => {})
    await p.locator('button[data-item-id]').first().click(); await p.waitForTimeout(500)
    await p.getByRole('button', { name: /Adicionar/ }).last().click(); await p.waitForTimeout(600)
    if (nome === 'tablet') await p.getByText('Ver sacola').first().click()
    else await p.getByRole('button', { name: /Sacola/ }).first().click()
    await p.waitForTimeout(600)
    ok(`${nome}: sacola nova com Continuar`, await p.getByTestId('topo-sacola').isVisible() && (await p.locator('button:visible').filter({ hasText: /^Continuar$/ }).count()) >= 1)
    ok(`${nome}: sem rolagem lateral`, await semRolagemLateral(p))
    await p.screenshot({ path: join(PRINTS, `sacola-${nome}.png`) })
    await ctx.close()
  }
} catch (e) {
  ok('execução sem exceção', false, String(e).slice(0, 300))
} finally {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL]).catch(() => {})
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [lojaPix.id, TEL_PIX]).catch(() => {})
  if (criadosCupom.length) {
    await db.query(`delete from cupom_usos where cupom_id = any($1)`, [criadosCupom]).catch(() => {})
    await db.query(`delete from cupons where id = any($1)`, [criadosCupom]).catch(() => {})
  }
  if (criadosBump.length) await db.query(`delete from order_bumps where id = any($1)`, [criadosBump]).catch(() => {})
  await db.query(`update restaurantes set vitrine_imagem_tamanho=$2, vitrine_fonte=$3, aceita_entrega=$4, aceita_retirada=$5 where id=$1`, [loja.id, loja.t, loja.f, loja.e, loja.r])
  await db.query(`update restaurantes set layout_cardapio=$2, vitrine_imagem_tamanho=$3, vitrine_fonte=$4 where id=$1`, [demo.id, demo.l, demo.t, demo.f])
  for (const [id, vn] of [[loja.id, loja.vn], [lojaPix.id, lojaPix.vn], [demo.id, demo.vn], [classica.id, classica.vn]]) await db.query('update restaurantes set vitrine_nova=$2 where id=$1', [id, vn])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
