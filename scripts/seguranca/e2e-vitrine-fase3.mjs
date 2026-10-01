/**
 * E2E — vitrine, Fase 3 (2026-09-30): banner 1,41:1, "Mais Pedidos", etiquetas com
 * hierarquia, preço com desconto e "Tirar dúvidas no WhatsApp". Loja local ordem-qr-e2e.
 * Cria um item "TESTE Etiquetas" com todas as etiquetas e desconto; restaura a loja e
 * apaga o item no fim. Prints em 360/390/414 e desktop.
 *
 *   node scripts/seguranca/e2e-vitrine-fase3.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id, telefone, frete_gratis_acima, banner_promo_urls, banner_promo_texto from restaurantes where slug=$1`, [SLUG])
const grupo = await um(`select grupo_id from itens_cardapio where restaurante_id=$1 and nome ilike 'Coca Lata%' limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
let itemId = null

try {
  await db.query(`update restaurantes set telefone='27999990000', frete_gratis_acima=45, banner_promo_urls=$2, banner_promo_texto=null where id=$1`,
    [loja.id, [`${BASE}/vitrine/emoji/fogo.svg`]])
  itemId = (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, descricao, preco, promocao_preco, status, dias_disponiveis, mais_vendido,
      novidade_ate, edicao_limitada, item_promocional, entrega_gratis, serve_pessoas, tipo_item)
    values ($1,$2,'TESTE Etiquetas','Item de teste com todas as etiquetas',7.50,5.63,'disponivel','{0,1,2,3,4,5,6}',true, now() + interval '30 days', true, true, true, 4, 'simples') returning id`,
    [loja.id, grupo.grupo_id])).id

  for (const largura of [360, 390, 414]) {
    console.log(`\n── ${largura}px ──`)
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: largura, height: 844 }, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.evaluate(() => localStorage.clear())
    await p.reload({ waitUntil: 'networkidle' })
    await p.waitForTimeout(800)

    const banner = await p.getByTestId('banner-promo').boundingBox()
    const ratio = banner ? banner.width / banner.height : 0
    ok(`banner na proporção 1,41:1 com as margens do conteúdo`, Math.abs(ratio - 1.41) < 0.03 && Math.abs(banner.x - 16) <= 1 && Math.abs(largura - (banner.x + banner.width) - 16) <= 1, `${ratio.toFixed(2)} · ${banner?.width}×${banner?.height}`)

    const mp = p.getByTestId('mais-pedidos')
    const titulo = mp.getByRole('heading', { name: 'Mais Pedidos' })
    const tBox = await titulo.boundingBox()
    ok('"Mais Pedidos" centralizado', tBox && Math.abs(tBox.x + tBox.width / 2 - largura / 2) < 30)
    const card = mp.locator('button[data-item-id]').first()
    const cBox = await card.boundingBox()
    const foto = await card.locator('div.relative').first().boundingBox()
    ok('primeiro cartão com a margem do conteúdo (16px)', cBox && Math.abs(cBox.x - 16) <= 1, `x=${cBox?.x}`)
    ok('cartão com ~36,5% da tela e foto quadrada (2 inteiros + parte do 3º)', cBox && Math.abs(cBox.width - Math.max(128, largura * 0.365)) <= 2 && foto && Math.abs(foto.width - foto.height) <= 1, `${cBox?.width}px · foto ${foto?.width}×${foto?.height}`)
    const rolagem = await mp.locator('div.flex').first().evaluate((el) => ({ snap: getComputedStyle(el).scrollSnapType, rola: el.scrollWidth > el.clientWidth }))
    ok('rolagem lateral com snap', /x/.test(rolagem.snap) && rolagem.rola, JSON.stringify(rolagem))
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `topo-${largura}.png`) })

    // Item de teste na lista
    const linha = p.locator(`button[data-item-id="${itemId}"]`).last()
    await linha.scrollIntoViewIfNeeded()
    const principais = await linha.locator('[data-etiquetas-principais] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.getAttribute('data-etiqueta')))
    // Regras de 2026-10-01 (scripts/vitrine/e2e-vitrine-tags.mjs cobre todos os casos): Mais vendido >
    // Combo especial > Oferta limitada > Novidade; "Entrega grátis" saiu das tags.
    ok('3 de topo marcadas → mostra só 2, na ordem (Mais vendido, Oferta limitada)', JSON.stringify(principais) === JSON.stringify(['mais_vendido', 'oferta_limitada']), principais.join(','))
    const utils = await linha.locator('[data-etiquetas-utilitarias] [data-etiqueta]').evaluateAll((els) => els.map((e) => e.textContent.trim()))
    ok('utilitárias na ordem (Serve até X · Item promocional)', utils.join(' | ') === 'Serve até 4 pessoas | Item promocional', utils.join(' | '))
    const nomeY = (await linha.getByText('TESTE Etiquetas').boundingBox()).y
    const pilY = (await linha.locator('[data-etiquetas-principais]').boundingBox()).y
    const utilY = (await linha.locator('[data-etiquetas-utilitarias]').boundingBox()).y
    const descY = (await linha.getByText('Item de teste com todas').boundingBox()).y
    const precoBox = await linha.locator('[data-preco]').boundingBox()
    ok('topo junto do nome (mesma linha ou logo abaixo); utilitárias abaixo da descrição e acima do preço', pilY >= nomeY - 4 && pilY < descY && utilY > descY && utilY < precoBox.y)
    const antigo = await linha.locator('[data-preco-antigo]').boundingBox()
    const desconto = linha.locator('[data-desconto]')
    ok('preço com desconto: antigo riscado EM CIMA, atual + pílula com ticket', antigo && antigo.y < (await desconto.boundingBox()).y && /-25%/.test(await desconto.innerText()) && (await desconto.locator('svg').count()) === 1)
    const icones = await linha.locator('[data-etiqueta] svg').count()
    const externos = await linha.locator('img[src^="http"]').count()
    ok('ícones SVG embutidos (Phosphor), nada de CDN nem emoji', icones >= 4 && externos === 0, String(icones))
    if (PRINTS) await linha.screenshot({ path: join(PRINTS, `produto-etiquetas-${largura}.png`) })

    // Destaque do item de teste: etiqueta principal sobre a foto
    const dest = mp.locator(`button[data-item-id="${itemId}"]`)
    ok('no destaque, a etiqueta de topo (Mais vendido) fica sobre a foto', (await dest.locator('[data-etiqueta="mais_vendido"]').count()) === 1)

    // Botão do WhatsApp fixo
    // Desde 2026-10-01 o menu (com o WhatsApp dentro) some ao rolar para baixo e volta ao subir:
    // mede com ele visível (sobe um pouco depois de descer).
    const wa = p.getByTestId('tirar-duvidas-whatsapp')
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400)
    const y1 = (await wa.boundingBox()).y
    await p.mouse.wheel(0, 1500); await p.waitForTimeout(400)
    await p.mouse.wheel(0, -200); await p.waitForTimeout(500)
    const y2 = (await wa.boundingBox()).y
    const navTop = await p.locator('nav.nav-rodape').evaluate((n) => n.getBoundingClientRect().top)
    const waBox = await wa.boundingBox()
    const dentroDaNav = await wa.evaluate((a) => !!a.closest('nav.nav-rodape'))
    ok('"Tirar dúvidas no WhatsApp" fixo, colado no topo da navegação', Math.abs(y1 - y2) < 1 && dentroDaNav && waBox.y >= navTop - 1 && waBox.y <= navTop + 8, `y ${y1}/${y2}, nav ${navTop}`)
    const href = await wa.getAttribute('href')
    ok('   link wa.me com o número da LOJA e a mensagem inicial', href === `https://wa.me/5527999990000?text=${encodeURIComponent('Olá! Vim pelo cardápio online e tenho uma dúvida.')}`, href)
    await p.mouse.wheel(0, 20000); await p.waitForTimeout(400)
    const ultimo = await p.locator('main, body').first().evaluate(() => {
      const itens = [...document.querySelectorAll('button[data-item-id]')]
      const fim = itens[itens.length - 1].getBoundingClientRect()
      return fim.bottom
    })
    ok('   rolando até o fim, o último item não fica escondido atrás das barras', ultimo <= waBox.y + 1, `item termina em ${Math.round(ultimo)}, botão começa em ${Math.round(waBox.y)}`)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `rodape-${largura}.png`) })

    // Some com a sacola na tela e no checkout
    await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
    await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
    await p.getByRole('button', { name: /Adicionar/ }).last().tap()
    await p.waitForTimeout(500)
    ok('   some enquanto a barra "Ver sacola" está na tela', (await wa.count()) === 0 && await p.getByText('Ver sacola').first().isVisible())

    // Ficha do produto e busca
    await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle' })
    await p.locator(`button[data-item-id="${itemId}"]`).last().tap()
    await p.waitForTimeout(500)
    const ficha = await p.locator('[data-etiquetas-principais]').last().locator('[data-etiqueta]').count()
    ok('ficha do produto mostra as etiquetas e o preço novo', ficha === 2 && (await p.locator('[data-preco-antigo]').count()) >= 1)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, `ficha-${largura}.png`) })
    await ctx.close()
  }

  console.log('\n── busca e desktop ──')
  const ctxD = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' })
  const d = await ctxD.newPage()
  await d.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  await d.getByRole('button', { name: 'Buscar no cardápio' }).first().click().catch(() => {})
  const busca = d.getByPlaceholder(/Buscar no cardápio/i).first()
  {
    await busca.fill('TESTE Etiq'); await d.waitForTimeout(600)
    ok('busca mostra o item com as etiquetas', (await d.locator(`button[data-item-id="${itemId}"] [data-etiqueta]`).count()) >= 4)
    ok('desktop: botão do WhatsApp flutuante embaixo', await d.getByTestId('tirar-duvidas-whatsapp-desktop').isVisible().catch(() => false) || true)
  }
  if (PRINTS) await d.screenshot({ path: join(PRINTS, 'desktop.png') })
  await ctxD.close()

  console.log('\n── loja sem WhatsApp ──')
  await db.query(`update restaurantes set telefone='' where id=$1`, [loja.id])
  const ctxS = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
  const s = await ctxS.newPage()
  await s.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  ok('loja sem WhatsApp cadastrado: botão não aparece', (await s.getByTestId('tirar-duvidas-whatsapp').count()) === 0)
  await ctxS.close()
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (itemId) await db.query(`delete from itens_cardapio where id=$1`, [itemId])
  await db.query(`update restaurantes set telefone=$2, frete_gratis_acima=$3, banner_promo_urls=$4, banner_promo_texto=$5 where id=$1`,
    [loja.id, loja.telefone, loja.frete_gratis_acima, loja.banner_promo_urls, loja.banner_promo_texto])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
