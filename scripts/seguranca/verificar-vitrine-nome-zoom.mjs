/**
 * Vitrine: nome de item sem marcação crua + zoom bloqueado (só na vitrine).
 *
 * Loja isolada `ordem-qr-e2e` da stack local. Cria dois itens de teste (um com
 * `**[[vermelho]]…[[/]]**`, um só com emoji) e apaga no fim. Não cria pedido:
 * o checkout vai até a revisão e para antes de "Fazer pedido".
 *
 *   BASE=http://127.0.0.1:3999 node scripts/seguranca/verificar-vitrine-nome-zoom.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'menuzia-shots-vitrine-nome')
const LOJA = 'ordem-qr-e2e'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
mkdirSync(SHOTS, { recursive: true })

const CRU = 'Bolo **[[vermelho]]Duplo[[/]]** Recheio 😎'
const LIMPO = 'Bolo Duplo Recheio 😎'
const EMOJI = 'Brigadeiro Gourmet 🍫✨'
const MARCA = /\[\[|\]\]|\*\*/

let falhas = 0
const ok = (nome, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${nome}${!cond && extra ? ` — ${extra}` : ''}`)
  if (!cond) falhas++
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const loja = await um(`select id from restaurantes where slug=$1`, [LOJA])
const grupo = await um(`select id from grupos_cardapio where restaurante_id=$1 and nome='Sobremesas'`, [loja.id])
await db.query(`delete from itens_cardapio where restaurante_id=$1 and nome in ($2,$3)`, [loja.id, CRU, EMOJI])
const pedidosAntes = (await um(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja.id])).n + 1 // + o de teste
const criar = (nome, desc, pos) =>
  um(
    `insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, posicao, status)
     values ($1,$2,$3,$4,$5,$6,'disponivel') returning id`,
    [loja.id, grupo.id, nome, desc, 19.9, pos],
  )
const itCru = await criar(CRU, 'Massa de chocolate com **recheio duplo**', 900)
const itEmoji = await criar(EMOJI, 'Caixa com 4', 901)
const TEL = '27999990000'
const TOKEN = 'token-teste-vitrine-nome'
const lojaAntes = await um(`select aceita_entrega, aceita_retirada from restaurantes where id=$1`, [loja.id])
await db.query(`update restaurantes set aceita_entrega=false, aceita_retirada=true where id=$1`, [loja.id])
await db.query(`delete from clientes where restaurante_id=$1 and telefone='55'||$2`, [loja.id, TEL])
await db.query(`insert into clientes (restaurante_id, telefone, nome, token) values ($1, '55'||$2, 'Cliente Teste', $3)`, [loja.id, TEL, TOKEN])
const ped = await um(
  `insert into pedidos (restaurante_id, status, tipo, subtotal, total, forma_pagamento, cliente_nome, cliente_telefone)
   values ($1,'preparando','retirada',19.9,19.9,'pix','Cliente Teste','55'||$2) returning id, numero`,
  [loja.id, TEL],
)
const NUM_PEDIDO = ped.numero
await db.query(`insert into pedido_itens (pedido_id, item_id, nome, quantidade, preco_unitario) values ($1,$2,$3,1,19.9)`, [ped.id, itCru.id, CRU])

const browser = await chromium.launch()
const textoVisivel = (p) => p.evaluate(() => document.body.innerText)
const semMarca = async (p, onde) => {
  const t = await textoVisivel(p)
  const linha = t.split('\n').find((l) => MARCA.test(l))
  ok(`${onde}: sem código cru`, !linha, linha)
}

try {
  for (const [w, h] of [[360, 780], [390, 844], [412, 915], [1366, 768]]) {
    const movel = w < 500
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: movel ? 2 : 1, isMobile: movel, hasTouch: movel, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(900)
    const fechar = p.getByText('Continuar no cardápio')
    if (await fechar.count()) await fechar.first().click().catch(() => {})

    const t = await textoVisivel(p)
    ok(`${w}: nome limpo no cardápio`, t.includes(LIMPO), t.slice(0, 200))
    ok(`${w}: nome com emoji intacto`, t.includes(EMOJI))
    ok(`${w}: nome normal intacto`, t.includes('X-Burger') && t.includes('Coca Lata 350 ml'))
    await semMarca(p, `${w} cardápio`)
    const cor = await p.evaluate(() => {
      const s = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Duplo')
      return s ? getComputedStyle(s).color : null
    })
    ok(`${w}: "Duplo" desenhado em vermelho`, cor === 'rgb(220, 38, 38)', String(cor))
    const larg = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    ok(`${w}: sem rolagem horizontal`, larg.sw <= larg.iw, JSON.stringify(larg))
    await p.screenshot({ path: join(SHOTS, `vitrine-${w}.png`) })

    // Ficha do produto
    await p.getByText(LIMPO).first().click()
    await p.waitForTimeout(700)
    const titulo = await p.locator('h2', { hasText: 'Recheio' }).first().innerText().catch(() => '')
    ok(`${w}: ficha com título limpo`, titulo.trim() === LIMPO, titulo)
    await semMarca(p, `${w} ficha`)
    await p.screenshot({ path: join(SHOTS, `ficha-${w}.png`) })
    if (w !== 390) { await ctx.close(); continue }

    // Sacola → checkout até a revisão (sem fazer pedido)
    await p.locator('button:has-text("Adicionar")').last().click()
    await p.waitForTimeout(700)
    await semMarca(p, 'toast/adicionado')
    await p.getByText('Ver sacola').first().click()
    await p.waitForTimeout(700)
    ok('sacola: nome limpo', (await textoVisivel(p)).includes(LIMPO))
    await semMarca(p, 'sacola')
    await p.screenshot({ path: join(SHOTS, 'sacola-390.png') })
    await p.getByText('Continuar para pagamento').first().click()
    await p.waitForTimeout(700)
    await semMarca(p, 'checkout')
    await p.screenshot({ path: join(SHOTS, 'checkout-390.png') })
    await ctx.close()
  }

  // Cliente logado (linha em `clientes`, como o OTP deixaria) com um pedido antigo cujo
  // item foi gravado com o nome cru: sacola salva antes do ajuste, checkout até a
  // revisão, histórico e detalhe. Loja só retirada durante o bloco, para o checkout
  // não depender de frete. Tudo desfeito no finally.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'domcontentloaded' })
    await p.evaluate(
      ({ slug, cru, id, tel, token }) => {
        const linha = { key: 'k1', itemId: id, name: cru, imagemUrl: null, qty: 1, unit: 19.9, addons: [], obs: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '' }
        localStorage.setItem(`menuzia_carrinho_${slug}`, JSON.stringify({ em: Date.now(), linhas: [linha] }))
        localStorage.setItem(`menuzia_cliente_${slug}`, JSON.stringify({ telefone: tel, token, verificado: true }))
      },
      { slug: LOJA, cru: CRU, id: itCru.id, tel: TEL, token: TOKEN },
    )
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(1000)
    const fechar = p.getByText('Continuar no cardápio')
    if (await fechar.count()) await fechar.first().click().catch(() => {})
    await semMarca(p, 'cardápio com sacola antiga')

    await p.getByText('Ver sacola').first().click()
    await p.waitForTimeout(600)
    ok('sacola antiga (nome cru salvo): mostra limpo', (await textoVisivel(p)).includes(LIMPO))
    await semMarca(p, 'sacola antiga')
    await p.getByText('Continuar para pagamento').first().click()
    await p.waitForTimeout(700)
    let chegou = false
    for (let passo = 0; passo < 5; passo++) {
      const nome = p.getByPlaceholder('Seu nome')
      if (await nome.count() && (await nome.first().inputValue()) === '') await nome.first().fill('Cliente Teste')
      await semMarca(p, `checkout passo ${passo}`)
      if (await p.getByRole('button', { name: /Fazer pedido/ }).count()) { chegou = true; break }
      const avancar = p.getByRole('button', { name: /Ir para pagamento|Ir para endereço|Continuar|Revisar pedido/ }).last()
      await avancar.click()
      await p.waitForTimeout(700)
    }
    await p.screenshot({ path: join(SHOTS, 'checkout-revisao-390.png') })
    const tRev = await textoVisivel(p)
    ok('checkout: chegou à revisão (sem fazer pedido)', chegou, tRev.slice(0, 200))
    ok('revisão do pedido: nome limpo', tRev.includes(LIMPO))
    await semMarca(p, 'revisão do pedido')

    await p.goto(`${BASE}/loja/${LOJA}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
    await p.getByRole('button', { name: 'Pedidos', exact: true }).first().click()
    await p.waitForTimeout(1500)
    const tHist = await textoVisivel(p)
    await p.screenshot({ path: join(SHOTS, 'pedidos-390.png') })
    ok('histórico: pedido de teste aparece', tHist.includes('#' + NUM_PEDIDO) || tHist.includes(String(NUM_PEDIDO)), tHist.slice(0, 300))
    ok('histórico: nome limpo', tHist.includes(LIMPO), tHist.slice(0, 300))
    await semMarca(p, 'histórico')
    const card = p.getByText(LIMPO).first()
    if (await card.count()) {
      await card.click()
      await p.waitForTimeout(800)
      await p.screenshot({ path: join(SHOTS, 'pedido-detalhe-390.png') })
      await semMarca(p, 'detalhe do pedido')
    }
    await ctx.close()
  }

  // Zoom: bloqueado na vitrine, liberado no painel
  {
    const html = await (await fetch(`${BASE}/loja/${LOJA}`)).text()
    const meta = (html.match(/<meta name="viewport" content="([^"]+)"/) ?? [])[1] ?? ''
    ok('vitrine: viewport com maximum-scale=1 e user-scalable=no', /maximum-scale=1/.test(meta) && /user-scalable=no/.test(meta), meta)
    const htmlLogin = await (await fetch(`${BASE}/login`)).text()
    const metaLogin = (htmlLogin.match(/<meta name="viewport" content="([^"]+)"/) ?? [])[1] ?? ''
    ok('painel (/login): viewport sem bloqueio de zoom', !/user-scalable|maximum-scale/.test(metaLogin), metaLogin)

    const pinca = async (url) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      const p = await ctx.newPage()
      await p.goto(url, { waitUntil: 'networkidle' })
      await p.waitForTimeout(600)
      // Dois dedos abrindo, evento a evento (o synthesizePinchGesture não amplia nem o
      // painel no headless — não provaria nada).
      const cdp = await ctx.newCDPSession(p)
      const toque = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
      await toque('touchStart', [{ x: 180, y: 400, id: 1 }, { x: 210, y: 400, id: 2 }])
      for (let i = 1; i <= 15; i++) {
        await toque('touchMove', [{ x: 180 - i * 8, y: 400, id: 1 }, { x: 210 + i * 8, y: 400, id: 2 }])
        await p.waitForTimeout(16)
      }
      await toque('touchEnd', [])
      await p.waitForTimeout(500)
      const escala = await p.evaluate(() => window.visualViewport?.scale ?? 1)
      const acao = await p.evaluate(() => getComputedStyle(document.documentElement).touchAction)
      return { ctx, p, escala, toque: acao, cdp }
    }
    const v = await pinca(`${BASE}/loja/${LOJA}`)
    ok('vitrine: pinça não amplia (scale 1)', v.escala === 1, String(v.escala))
    ok('vitrine: touch-action pan-x pan-y', v.toque === 'pan-x pan-y', v.toque)

    // Rolagem vertical com o dedo e busca continuam
    const antes = await v.p.evaluate(() => window.scrollY)
    const dedo = (type, touchPoints) => v.cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
    await dedo('touchStart', [{ x: 195, y: 700, id: 3 }])
    for (let i = 1; i <= 20; i++) {
      await dedo('touchMove', [{ x: 195, y: 700 - i * 25, id: 3 }])
      await v.p.waitForTimeout(16)
    }
    await dedo('touchEnd', [])
    await v.p.waitForTimeout(600)
    const depois = await v.p.evaluate(() => window.scrollY)
    ok('vitrine: rolagem vertical com toque funciona', depois > antes + 100, `${antes} → ${depois}`)
    await v.p.evaluate(() => window.scrollTo(0, 0))
    await v.p.waitForTimeout(300)
    const lupa = v.p.getByRole('button', { name: /buscar/i })
    if (await lupa.count()) await lupa.first().click()
    const busca = v.p.getByPlaceholder('Buscar no cardápio…')
    if (await busca.count()) {
      await busca.tap()
      await busca.fill('bolo')
      await v.p.waitForTimeout(500)
      const t = await textoVisivel(v.p)
      ok('busca por "bolo" acha o item limpo', t.includes(LIMPO) && !t.includes('X-Burger'), t.slice(0, 200))
      const esc = await v.p.evaluate(() => window.visualViewport?.scale ?? 1)
      ok('focar a busca não amplia a tela', esc === 1, String(esc))
    } else ok('campo de busca existe', false)
    await v.ctx.close()

    const a = await pinca(`${BASE}/login`)
    ok('painel (/login): pinça continua ampliando', a.escala > 1, String(a.escala))
    ok('painel: touch-action normal', a.toque === 'auto', a.toque)
    await a.ctx.close()
  }

  const pedidosDepois = (await um(`select count(*)::int n from pedidos where restaurante_id=$1`, [loja.id])).n
  ok('nenhum pedido criado', pedidosDepois === pedidosAntes, `${pedidosAntes} → ${pedidosDepois}`)
} finally {
  await browser.close()
  await db.query(`delete from pedido_itens where pedido_id=$1`, [ped.id])
  await db.query(`delete from pedidos where id=$1`, [ped.id])
  await db.query(`delete from clientes where restaurante_id=$1 and telefone='55'||$2`, [loja.id, TEL])
  await db.query(`update restaurantes set aceita_entrega=$2, aceita_retirada=$3 where id=$1`, [loja.id, lojaAntes.aceita_entrega, lojaAntes.aceita_retirada])
  await db.query(`delete from itens_cardapio where id = any($1)`, [[itCru.id, itEmoji.id]])
  await db.end()
}
console.log(`\n${falhas === 0 ? 'OK' : `${falhas} FALHA(S)`} — capturas em ${SHOTS}`)
process.exit(falhas ? 1 : 0)
