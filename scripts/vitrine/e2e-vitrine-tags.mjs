/**
 * E2E — tags repaginadas, preço com desconto (2026-10-01). Desde a P8 (2026-10-04): "Mais Pedidos" é selo
 * sobre a foto (não mais a pílula "Mais vendido" na linha do nome) e o menu de baixo fica sempre visível.
 * Stack local, loja ordem-qr-e2e. Semeia produtos "TESTE …" cobrindo todos os casos,
 * confere posição/ordem/limite/cores e tira prints em 360/390/414 e desktop da lista,
 * destaques, busca, ficha e sacola. Apaga os produtos TESTE no fim.
 *
 *   node scripts/vitrine/e2e-vitrine-tags.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})` }

// Casos (nome → colunas). Ordem = ordem na categoria.
const CASOS = [
  ['TESTE MV', { mais_vendido: true }],
  ['TESTE Combo especial', { combo_especial: true }],
  ['TESTE Oferta limitada', { edicao_limitada: true }],
  ['TESTE Novidade', { novidade_ate: 'now30' }],
  ['TESTE Quatro de topo', { mais_vendido: true, combo_especial: true, edicao_limitada: true, novidade_ate: 'now30' }],
  ['TESTE X-Burger', { mais_vendido: true, serve_pessoas: 4, item_promocional: true }, 'Pão, bife de hambúrguer, queijo, alface, tomate, milho, batata palha'],
  ['TESTE Serve 1', { serve_pessoas: 1 }],
  ['TESTE Serve 10', { serve_pessoas: 10 }],
  ['TESTE Personalizada preta', { tag_personalizada: 'Receita da casa especial', tag_personalizada_cor: 'preta' }],
  ['TESTE Personalizada azul', { tag_personalizada: 'Sem glúten e sem lactose', tag_personalizada_cor: 'azul' }],
  ['TESTE X-Burger artesanal duplo com cheddar e bacon crocante', { mais_vendido: true }],
  ['TESTE Desconto', { promocao_preco: 5.63 }],
  ['TESTE Desconto com tags', { promocao_preco: 5.63, combo_especial: true, serve_pessoas: 2, item_promocional: true }],
  ['TESTE Sem tags', {}],
]

const browser = await chromium.launch()
let grupoId = null
const ids = {}
try {
  await db.query(`delete from itens_cardapio where restaurante_id=$1 and nome like 'TESTE %'`, [loja.id])
  await db.query(`delete from grupos_cardapio where restaurante_id=$1 and nome='TESTE Tags'`, [loja.id])
  grupoId = (await um(`insert into grupos_cardapio (restaurante_id, nome, posicao) values ($1,'TESTE Tags',-1) returning id`, [loja.id])).id
  let pos = 0
  for (const [nome, c, desc] of CASOS) {
    const r = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, promocao_preco, status, dias_disponiveis, mais_vendido,
        novidade_ate, combo_especial, edicao_limitada, item_promocional, serve_pessoas, tag_personalizada, tag_personalizada_cor, tipo_item, posicao)
      values ($1,$2,$3,$4,7.50,$5,'disponivel','{0,1,2,3,4,5,6}',$6, case when $7 then now() + interval '30 days' end,$8,$9,$10,$11,$12,$13,'simples',$14) returning id`,
      [loja.id, grupoId, nome, desc ?? 'Descrição curta do produto de teste.', c.promocao_preco ?? null, !!c.mais_vendido, !!c.novidade_ate, !!c.combo_especial,
        !!c.edicao_limitada, !!c.item_promocional, c.serve_pessoas ?? null, c.tag_personalizada ?? null, c.tag_personalizada_cor ?? 'preta', pos++])
    ids[nome] = r.id
  }
  // "A partir de": item com tamanhos (o menor vale).
  const ap = await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, status, dias_disponiveis, tipo_item, posicao, combo_especial)
    values ($1,$2,'TESTE A partir de','Escolha o tamanho.',0,'disponivel','{0,1,2,3,4,5,6}','simples',$3,true) returning id`, [loja.id, grupoId, pos++])
  await db.query(`insert into tamanhos_item (item_id, nome, preco, posicao) values ($1,'Pequeno',20,0),($1,'Grande',30,1)`, [ap.id])
  ids['TESTE A partir de'] = ap.id

  for (const [rotulo, opts] of [
    ['360', { ...devices['iPhone 13'], viewport: { width: 360, height: 800 } }],
    ['390', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
    ['414', { ...devices['iPhone 13'], viewport: { width: 414, height: 896 } }],
    ['desktop', { viewport: { width: 1366, height: 900 } }],
  ]) {
    console.log(`\n── ${rotulo} ──`)
    const ctx = await browser.newContext({ ...opts, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => localStorage.clear())
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
    const linha = (nome) => p.locator(`button[data-item-id="${ids[nome]}"]`).last()
    const topo = (nome) => linha(nome).locator('[data-etiquetas-principais] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.getAttribute('data-etiqueta')))
    const utils = (nome) => linha(nome).locator('[data-etiquetas-utilitarias] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.textContent.trim()))

    await linha('TESTE MV').scrollIntoViewIfNeeded()
    if (rotulo === '390') {
      const selo = linha('TESTE MV').locator('[data-selo-mais-pedidos]')
      ok('Mais Pedidos: selo vermelho rgb(232 0 2), texto branco negrito, sobre a foto (nada na linha do nome)', JSON.stringify(await topo('TESTE MV')) === '[]' &&
        (await selo.evaluate((e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.fontWeight, e.textContent] })).join('|') === 'rgb(232, 0, 2)|rgb(255, 255, 255)|700|Mais Pedidos')
      const nomeBox = await linha('TESTE Novidade').getByText('TESTE Novidade', { exact: true }).boundingBox()
      const tagBox = await linha('TESTE Novidade').locator('[data-etiqueta="novidade"]').boundingBox()
      ok('tag de topo na MESMA linha do nome, à direita', tagBox && nomeBox && tagBox.x > nomeBox.x + nomeBox.width && Math.abs((tagBox.y + tagBox.height / 2) - (nomeBox.y + nomeBox.height / 2)) < 8, `nome y=${nomeBox?.y} tag y=${tagBox?.y}`)
      ok('Combo especial roxo (#9A3AE1 em #F2EAFC)', (await linha('TESTE Combo especial').locator('[data-etiqueta="combo_especial"]').evaluate((e) => getComputedStyle(e).color)) === rgb('#9A3AE1'))
      ok('Oferta limitada rosa (#BE185D em #FCE7F3)', (await linha('TESTE Oferta limitada').locator('[data-etiqueta="oferta_limitada"]').evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor].join('|'))) === `${rgb('#BE185D')}|${rgb('#FCE7F3')}`)
      ok('4 de topo → só 2, na ordem (Combo especial, Oferta limitada) + selo Mais Pedidos na foto', JSON.stringify(await topo('TESTE Quatro de topo')) === '["combo_especial","oferta_limitada"]' && (await linha('TESTE Quatro de topo').locator('[data-selo-mais-pedidos]').count()) === 1)
      ok('selo + utilitárias (Serve até 4 · Item promocional)', JSON.stringify(await topo('TESTE X-Burger')) === '[]' && (await linha('TESTE X-Burger').locator('[data-selo-mais-pedidos]').count()) === 1 && (await utils('TESTE X-Burger')).join('|') === 'Serve até 4 pessoas|Item promocional', (await utils('TESTE X-Burger')).join('|'))
      ok('Serve 1 pessoa (singular) / Serve até 10 pessoas', (await utils('TESTE Serve 1')).join() === 'Serve 1 pessoa' && (await utils('TESTE Serve 10')).join() === 'Serve até 10 pessoas')
      const nov = linha('TESTE Novidade').locator('[data-etiqueta="novidade"]')
      ok('Novidade: fundo rgb(0 255 142 / 35%), texto rgb(0 45 3), ícone de selo',
        (await nov.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color].join('|'))) === 'rgba(0, 255, 142, 0.35)|rgb(0, 45, 3)' && (await nov.locator('svg path[fill-rule="evenodd"]').count()) === 1)
      const preta = linha('TESTE Personalizada preta').locator('[data-etiqueta="personalizada"]')
      const azul = linha('TESTE Personalizada azul').locator('[data-etiqueta="personalizada"]')
      ok('personalizada preta e azul, 24 caracteres, uma linha', (await preta.textContent()) === 'Receita da casa especial' && (await preta.evaluate((e) => getComputedStyle(e).backgroundColor)) === rgb('#1F1F1F') &&
        (await azul.evaluate((e) => getComputedStyle(e).color)) === rgb('#17618B') && (await preta.boundingBox()).height <= 23)
      const longo = linha('TESTE X-Burger artesanal duplo com cheddar e bacon crocante')
      const lt = await longo.locator('[data-selo-mais-pedidos]').boundingBox()
      // A foto (ou o quadro cinza de quem não tem foto) é o irmão do selo dentro do mesmo quadro.
      const foto = await longo.locator('[data-selo-mais-pedidos]').evaluate((e) => { const r = e.parentElement.firstElementChild.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width } })
      ok('nome longo: o selo fica na foto (canto superior esquerdo), que não se mexe', lt && foto && Math.abs(lt.y - foto.y) <= 1 && Math.abs(lt.x - foto.x) <= 1 && foto.width >= 119, `selo ${lt?.x},${lt?.y} foto ${foto?.x},${foto?.y} w=${foto?.width}`)
      const preco = linha('TESTE Desconto').locator('[data-preco]')
      const antigo = await preco.locator('[data-preco-antigo]').evaluate((e) => ({ t: e.textContent, d: getComputedStyle(e).textDecorationLine, c: getComputedStyle(e).color, y: e.getBoundingClientRect().y }))
      const atual = await preco.locator('[data-preco-atual]').evaluate((e) => ({ t: e.textContent, y: e.getBoundingClientRect().y }))
      const pil = await preco.locator('[data-desconto]').evaluate((e) => ({ t: e.textContent, c: getComputedStyle(e).color, b: getComputedStyle(e).backgroundColor }))
      // Pendência 9 (2026-10-06): selo verde sólido e preço antigo #737373 (contraste ≥ 4,5:1).
      ok('desconto: original riscado cinza EM CIMA, atual embaixo + selo verde sólido -25%', antigo.t.includes('7,50') && antigo.d.includes('line-through') && antigo.c === rgb('#737373') && antigo.y < atual.y && atual.t.includes('5,63') &&
        pil.t.trim() === '-25%' && pil.c === rgb('#FFFFFF') && pil.b === rgb('#0B7A3E'), JSON.stringify({ antigo, atual, pil }))
      ok('desconto + tags', JSON.stringify(await topo('TESTE Desconto com tags')) === '["combo_especial"]' && (await utils('TESTE Desconto com tags')).length === 2 && (await linha('TESTE Desconto com tags').locator('[data-desconto]').count()) === 1)
      ok('"A partir de" mantido', (await linha('TESTE A partir de').locator('[data-preco]').textContent()).includes('A partir de'))
      if (PRINTS) {
        for (const [nome, arq] of [['TESTE X-Burger', 'recorte-xburger'], ['TESTE Combo especial', 'recorte-combo'], ['TESTE Desconto com tags', 'recorte-desconto-tags'], ['TESTE Desconto', 'recorte-desconto'], ['TESTE Personalizada preta', 'recorte-personalizada-preta'], ['TESTE Personalizada azul', 'recorte-personalizada-azul'], ['TESTE Oferta limitada', 'recorte-oferta']]) {
          await linha(nome).scrollIntoViewIfNeeded()
          await linha(nome).screenshot({ path: join(PRINTS, `${arq}.png`) })
        }
      }
      ok('sem tags: nada de espaço de tag', (await linha('TESTE Sem tags').locator('[data-etiquetas-principais], [data-etiquetas-utilitarias]').count()) === 0)
    }
    if (PRINTS) {
      await linha('TESTE MV').scrollIntoViewIfNeeded()
      await p.screenshot({ path: join(PRINTS, `lista-${rotulo}-1.png`) })
      await linha('TESTE Personalizada preta').scrollIntoViewIfNeeded()
      await p.screenshot({ path: join(PRINTS, `lista-${rotulo}-2.png`) })
      await linha('TESTE Desconto').scrollIntoViewIfNeeded()
      await p.screenshot({ path: join(PRINTS, `lista-${rotulo}-3.png`) })
    }
    // Destaques (os itens com estrela entram em "Mais Pedidos"): NENHUMA tag (2026-10-01).
    const mp = p.getByTestId('mais-pedidos')
    if (await mp.count()) {
      await mp.scrollIntoViewIfNeeded()
      const card = mp.locator(`button[data-item-id="${ids['TESTE Quatro de topo']}"]`)
      if (await card.count()) {
        const n = await card.locator('[data-etiqueta]').count()
        ok(`destaques ${rotulo}: nenhuma tag, mesmo com 4 marcadas`, n === 0, String(n))
      }
      if (PRINTS) await p.screenshot({ path: join(PRINTS, `destaques-${rotulo}.png`) })
    }
    // Chip de Promoções: cores da tag de desconto, acende só quando ativa; contador só texto.
    if (rotulo === '390') {
      await p.evaluate(() => window.scrollTo(0, 0))
      const chip = p.locator('[data-chip-promocoes]').first()
      const cores = () => chip.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color].join('|'))
      const antes = await cores()
      await chip.click()
      await p.locator('[data-contador-promocoes]').waitFor({ timeout: 5000 })
      await p.waitForTimeout(500) // transição de cor de 150 ms
      const acesas = await chip.locator('xpath=..').locator('button[class*=" bg-[var(--tema-primaria)]"]').count()
      ok('só a chip de Promoções acesa (nenhuma categoria junto)', acesas === 0, String(acesas))
      ok('chip Promoções: apagado antes, verde do desconto (#EAFFF5 / #24A96A) quando ativa', !antes.startsWith('rgb(234, 255, 245)') && (await cores()) === 'rgb(234, 255, 245)|rgb(36, 169, 106)', antes + ' → ' + (await cores()))
      const cont = await p.locator('[data-contador-promocoes]').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color].join('|'))
      ok('contador da seção Promoções sem fundo, texto verde escuro', cont === 'rgba(0, 0, 0, 0)|rgb(21, 128, 61)', cont)
      if (PRINTS) await p.screenshot({ path: join(PRINTS, 'promocoes-390.png') })
      await p.reload({ waitUntil: 'networkidle' })
      await p.waitForTimeout(800)
    }
    // Busca
    await p.evaluate(() => window.scrollTo(0, 0))
    await p.getByRole('button', { name: 'Buscar no cardápio' }).first().click().catch(() => {})
    const busca = p.getByPlaceholder('Buscar no cardápio…').first()
    await busca.waitFor({ timeout: 5000 }).catch(() => {})
    if (rotulo === '390') ok('busca aberta', await busca.isVisible())
    if (await busca.count()) {
      await busca.fill('TESTE X-Burger').catch(() => {})
      await p.waitForTimeout(600)
      if (rotulo === '390') ok('busca: mesmas tags', (await p.locator(`button[data-item-id="${ids['TESTE X-Burger']}"] [data-selo-mais-pedidos]`).count()) >= 1)
      if (PRINTS) await p.screenshot({ path: join(PRINTS, `busca-${rotulo}.png`) })
      await busca.fill('').catch(() => {})
      await p.waitForTimeout(400)
    }
    // Ficha do produto
    await linha('TESTE Desconto com tags').scrollIntoViewIfNeeded()
    await linha('TESTE Desconto com tags').click()
    await p.waitForTimeout(700)
    if (rotulo === '390') ok('ficha: tag de topo, utilitárias e preço com desconto', (await p.locator('[data-etiqueta="combo_especial"]').count()) >= 1 && (await p.locator('[data-desconto]').count()) >= 1)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `ficha-${rotulo}.png`) })
    await p.getByRole('button', { name: /Adicionar/ }).last().click()
    await p.waitForTimeout(600)
    // Sacola
    if (rotulo !== 'desktop') {
      await p.getByText('Ver sacola').first().click()
      await p.waitForTimeout(600)
      if (rotulo === '390') ok('sacola: preço original riscado na linha com desconto', (await p.locator('[data-preco-antigo]').count()) >= 1)
    }
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `sacola-${rotulo}.png`) })

    // Menu de baixo SEMPRE visível (P8, 2026-10-04 — antes sumia ao rolar).
    if (rotulo === '390') {
      await p.getByRole('button', { name: /^Home$/ }).first().click().catch(() => {})
      await p.evaluate(() => window.scrollTo(0, 0))
      await p.waitForTimeout(300)
      const estado = () => p.getByTestId('nav-rodape').getAttribute('data-oculta')
      for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 250); await p.waitForTimeout(120) }
      await p.waitForTimeout(400)
      const desceu = await estado()
      const navBox = await p.getByTestId('nav-rodape').boundingBox()
      for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -200); await p.waitForTimeout(120) }
      await p.waitForTimeout(400)
      const subiu = await estado()
      ok('menu continua visível ao rolar para baixo e para cima', desceu === 'nao' && subiu === 'nao' && navBox && navBox.y + navBox.height <= 844 + 1 && navBox.y < 844 - 40, `${desceu}/${subiu} y=${navBox?.y}`)
      const rolaDoc = await p.evaluate(() => ({ doc: document.scrollingElement.scrollTop > 0, h: document.documentElement.scrollHeight > innerHeight }))
      ok('a rolagem é a do documento (a barra do navegador pode recolher)', rolaDoc.doc && rolaDoc.h)
    }
    await ctx.close()
  }
} catch (e) {
  console.error(e); res.push(false)
} finally {
  const lista = Object.values(ids)
  if (lista.length) {
    await db.query(`delete from tamanhos_item where item_id = any($1)`, [lista])
    await db.query(`delete from itens_cardapio where id = any($1)`, [lista])
  }
  if (grupoId) await db.query(`delete from grupos_cardapio where id=$1`, [grupoId])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
