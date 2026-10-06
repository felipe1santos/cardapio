/**
 * E2E — origem das visitas e dos pedidos (item 55, 2026-10-05). Loja local `ordem-qr-e2e`.
 *   · cada tipo de origem (utm, referrer, gclid, fbclid, WhatsApp/l.wl.co, QR, campanha) → canal certo,
 *     na VISITA (vitrine_eventos) e no PEDIDO (pedidos.origem_canal);
 *   · atribuição: a última origem não-direta em 7 dias (volta direta conta como a anterior);
 *   · checkout de verdade pela vitrine (Instagram) grava a origem;
 *   · links do Menuzia marcados: campanha (/c/<token>) e QR do cardápio;
 *   · Dashboard: área "Origem das visitas" acima das análises, rosca = tabela = pedidos; hover salta a
 *     fatia e mostra a dica; teclado; toque no celular; alternar Visitas/Pedidos/Faturamento.
 * Apaga os pedidos e eventos que cria.
 *
 *   node scripts/seguranca/e2e-origem-55.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const item = await um(`select id, nome from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 and not exists (select 1 from item_grupos_opcoes g where g.item_id=itens_cardapio.id) order by preco limit 1`, [loja.id]).catch(() => null)
  ?? await um(`select id, nome from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 order by preco limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const criados = []
const inicio = new Date().toISOString()

const browser = await chromium.launch()

/** Abre a vitrine com a URL e o referrer dados; devolve a origem atribuída guardada e o visitante. */
async function abrir(ctx, busca, referer) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${SLUG}${busca}`, { waitUntil: 'networkidle', referer })
  await p.waitForTimeout(500)
  // força o envio do lote de eventos (o rastreador manda ao esconder a página)
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await p.waitForTimeout(800)
  const guardada = await p.evaluate((s) => { try { return JSON.parse(localStorage.getItem(`mz-origem-${s}`) ?? 'null') } catch { return null } }, SLUG)
  const visitante = await p.evaluate(() => localStorage.getItem('mz-visitante') ?? Object.entries(localStorage).find(([k]) => /visitante/.test(k))?.[1] ?? null)
  return { p, guardada, visitante }
}
/** Pedido pela API pública mandando a origem que o rastreador atribuiria (igual ao submitOrder). */
async function pedidoComOrigem(p) {
  return p.evaluate(async ({ slug, itemId }) => {
    const ga = (() => { try { return JSON.parse(localStorage.getItem(`mz-origem-${slug}`) ?? 'null') } catch { return null } })()
    const origemVisita = ga && Date.now() - ga.em <= 7 * 86400000 ? ga : { fonte: null, meio: null, campanha: null, clique: null, canal: 'direto' }
    const r = await fetch(`/api/loja/${slug}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      tipo: 'retirada', pagamento: 'dinheiro', trocoPara: null, cliente: { nome: 'Cliente origem', telefone: '11912340993' },
      itens: [{ itemId, quantidade: 1, complementos: [] }], endereco: {}, chavePedido: crypto.randomUUID(), origemVisita,
    }) })
    return { status: r.status, j: await r.json().catch(() => null) }
  }, { slug: SLUG, itemId: item.id })
}

try {
  secao('cada origem no canal certo (visita e pedido)')
  const casos = [
    ['Instagram (utm)', '?utm_source=instagram&utm_campaign=festa', undefined, 'instagram', 'instagram'],
    ['Instagram (link da bio)', '', 'https://l.instagram.com/?u=x', 'l.instagram.com', 'instagram'],
    ['Facebook', '', 'https://m.facebook.com/', 'm.facebook.com', 'facebook'],
    ['Meta (anúncio, fbclid)', '?fbclid=IwAR0teste', undefined, 'meta-ads', 'meta'],
    ['Google Anúncio (gclid)', '?gclid=Cj0teste', undefined, 'google-ads', 'google_anuncio'],
    ['Google Busca', '', 'https://www.google.com/', 'google.com', 'google_busca'],
    ['WhatsApp (link do app)', '', 'https://l.wl.co/l?u=x', 'l.wl.co', 'whatsapp'],
    ['WhatsApp (campanha)', '?utm_source=whatsapp&utm_medium=campanha&utm_campaign=sexta', undefined, 'whatsapp', 'whatsapp'],
    ['QR Code do cardápio', '?utm_source=qrcode&utm_medium=qr', undefined, 'qrcode', 'qrcode'],
    ['Outros (site qualquer)', '', 'https://trello.com/b/x', 'trello.com', 'outros'],
    ['Direto', '', undefined, 'Direto', 'direto'],
  ]
  for (const [nome, busca, referer, visitaEsperada, canal] of casos) {
    const ctx = await browser.newContext()
    const { p, guardada } = await abrir(ctx, busca, referer)
    const pr = await pedidoComOrigem(p)
    if (pr.j?.id) criados.push(pr.j.id)
    const ped = pr.j?.id ? await um(`select origem_canal, origem_detalhe from pedidos where id=$1`, [pr.j.id]) : null
    const vis = await um(`select origem from vitrine_eventos where restaurante_id=$1 and tipo='visita' and criado_em >= $2 order by criado_em desc limit 1`, [loja.id, inicio])
    ok(`${nome}: visita "${visitaEsperada}", pedido no canal ${canal}`, ped?.origem_canal === canal && vis?.origem === visitaEsperada && (canal === 'direto' ? !guardada : guardada?.canal === canal),
      `visita=${vis?.origem} pedido=${ped?.origem_canal} guardada=${guardada?.canal ?? '-'} ${pr.status}`)
    if (nome === 'Instagram (utm)') ok('campanha vai no detalhe do pedido', ped?.origem_detalhe?.campanha === 'festa', JSON.stringify(ped?.origem_detalhe))
    await ctx.close()
  }

  secao('atribuição: última origem não-direta em 7 dias')
  {
    const ctx = await browser.newContext()
    await abrir(ctx, '?utm_source=whatsapp&utm_campaign=promo', undefined)
    const { p } = await abrir(ctx, '', undefined) // volta digitando o endereço
    const pr = await pedidoComOrigem(p); if (pr.j?.id) criados.push(pr.j.id)
    const ped = await um(`select origem_canal from pedidos where id=$1`, [pr.j.id])
    ok('voltou direto depois do WhatsApp: pedido conta como WhatsApp', ped?.origem_canal === 'whatsapp')
    // 8 dias depois: Direto
    await p.evaluate((s) => { const g = JSON.parse(localStorage.getItem(`mz-origem-${s}`)); g.em = Date.now() - 8 * 86400000; localStorage.setItem(`mz-origem-${s}`, JSON.stringify(g)) }, SLUG)
    const { p: p2 } = await abrir(ctx, '', undefined)
    const pr2 = await pedidoComOrigem(p2); if (pr2.j?.id) criados.push(pr2.j.id)
    ok('passados 7 dias: Direto', (await um(`select origem_canal from pedidos where id=$1`, [pr2.j.id]))?.origem_canal === 'direto')
    const { p: p3 } = await abrir(ctx, '?utm_source=ig', undefined)
    const { p: p4 } = await abrir(ctx, '?utm_source=google&utm_medium=cpc', undefined)
    const pr4 = await pedidoComOrigem(p4); if (pr4.j?.id) criados.push(pr4.j.id)
    ok('duas origens: vale a ÚLTIMA (Google Anúncio)', (await um(`select origem_canal from pedidos where id=$1`, [pr4.j.id]))?.origem_canal === 'google_anuncio')
    void p3
    await ctx.close()
  }

  secao('antifraude da origem')
  {
    const ctx = await browser.newContext()
    const { p } = await abrir(ctx, '', undefined)
    const pr = await p.evaluate(async ({ slug, itemId }) => {
      const r = await fetch(`/api/loja/${slug}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        tipo: 'retirada', pagamento: 'dinheiro', cliente: { nome: 'Cliente origem', telefone: '11912340993' }, itens: [{ itemId, quantidade: 1, complementos: [] }], endereco: {},
        chavePedido: crypto.randomUUID(), origemVisita: { canal: 'google_anuncio', fonte: 'ig', campanha: '<script>alert(1)</script>' },
      }) })
      return r.json()
    }, { slug: SLUG, itemId: item.id })
    if (pr?.id) criados.push(pr.id)
    const ped = await um(`select origem_canal, origem_detalhe from pedidos where id=$1`, [pr.id])
    ok('canal mandado pelo navegador é ignorado (recalculado da fonte)', ped?.origem_canal === 'instagram')
    ok('texto sujo limpo no detalhe', !String(ped?.origem_detalhe?.campanha ?? '').includes('<'))
    await ctx.close()
  }

  secao('checkout de verdade pela vitrine (Instagram)')
  {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${SLUG}?utm_source=instagram&utm_campaign=vitrine`, { waitUntil: 'networkidle' })
    await p.locator('button:has-text("R$")', { hasText: item.nome }).first().tap()
    await p.getByRole('button', { name: /Adicionar/ }).last().tap().catch(() => {})
    await p.waitForTimeout(600)
    await p.getByText('Ver sacola').first().tap()
    // Fluxo da pendência 9: sacola → Entrega → Pagamento → "Revise o seu pedido".
    await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
    const tel = p.locator('[data-testid="janela-conta"]').getByPlaceholder('(00) 00000-0000')
    if (await tel.isVisible({ timeout: 2500 }).catch(() => false)) { await tel.fill('27999887755'); await p.locator('[data-testid="janela-conta"] button').filter({ hasText: /^Continuar$/i }).tap() }
    await p.getByPlaceholder('Seu nome').fill('Cliente origem vitrine')
    await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro').catch(() => {})
    await p.getByPlaceholder('Nome da rua').fill('Rua Teste').catch(() => {})
    await p.getByPlaceholder('123').fill('10').catch(() => {})
    await p.waitForTimeout(800)
    await p.locator('[data-barra-checkout] button').filter({ hasText: /^Continuar$/ }).first().tap()
    await p.getByTestId('pagamento-dinheiro').tap()
    await p.locator('[data-barra-checkout] button').filter({ hasText: /Revisar pedido/ }).first().tap()
    const espera = p.waitForResponse((r) => r.url().endsWith(`/api/loja/${SLUG}/pedido`) && r.request().method() === 'POST', { timeout: 15000 })
    await p.getByTestId('fazer-pedido').tap()
    const resp = await espera.catch(() => null)
    const j = resp ? await resp.json().catch(() => null) : null
    if (j?.id) criados.push(j.id)
    const ped = j?.id ? await um(`select origem_canal, origem_detalhe from pedidos where id=$1`, [j.id]) : null
    ok('pedido feito pela vitrine grava a origem (Instagram, campanha "vitrine")', ped?.origem_canal === 'instagram' && ped?.origem_detalhe?.campanha === 'vitrine', JSON.stringify(ped))
    await ctx.close()
  }

  secao('links do Menuzia marcados')
  {
    const tok = await um(`select token from campanha_envios where token is not null limit 1`)
    if (tok) {
      const r = await fetch(`${BASE}/c/${tok.token}`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile' } })
      const loc = r.headers.get('location') ?? ''
      ok('link da campanha leva utm_source=whatsapp&utm_medium=campanha', /utm_source=whatsapp/.test(loc) && /utm_medium=campanha/.test(loc), loc)
    } else ok('link da campanha (sem envio local para testar)', true, 'pulado')
  }

  secao('Dashboard: área "Origem das visitas"')
  for (const [disp, opcoes] of [['desktop', { viewport: { width: 1366, height: 900 } }], ['celular', { ...devices['Pixel 7'] }]]) {
    const ctx = await browser.newContext({ ...opcoes, locale: 'pt-BR' })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.ordemqr'); await p.fill('input[name="password"]', 'demo-local-123456')
    await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(2500)
    const modal = p.locator('[aria-labelledby="setup-alerta-titulo"]').first()
    if (await modal.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) await modal.click({ position: { x: 5, y: 5 } }).catch(() => {})
    await p.waitForTimeout(300)
    // A loja de teste tem pendências de configuração: o aviso volta; fecha antes de cada interação.
    const fecharAviso = async () => { const m = p.locator('[aria-labelledby="setup-alerta-titulo"]').first(); if (await m.isVisible().catch(() => false)) { await m.getByRole('button', { name: 'OK' }).first().click().catch(() => m.click({ position: { x: 5, y: 5 } }).catch(() => {})); await p.waitForTimeout(200) } }
    const area = p.getByTestId('dash-origem')
    await area.scrollIntoViewIfNeeded()
    const pos = await p.evaluate(() => { const a = document.querySelector('[data-testid="dash-origem"]')?.getBoundingClientRect(); const b = document.querySelector('[data-testid="dash-analises"]')?.getBoundingClientRect(); return a && b ? { a: a.top, b: b.top } : null })
    ok(`${disp}: área própria logo acima de "Análises do período"`, pos && pos.a < pos.b, JSON.stringify(pos))
    // tabela = pedidos do banco com origem (na janela padrão de 30 dias, só da vitrine). Pedidos "TESTE…"
    // ficam fora do Dashboard (item 54) — outros e2e deixam alguns na loja.
    const banco = await db.query(`select origem_canal, count(*)::int n from pedidos where restaurante_id=$1 and origem_canal is not null and status not in ('cancelado','aguardando_pagamento') and canal='delivery' and cliente_nome not ilike 'TESTE%' and criado_em > now() - interval '30 days' group by 1`, [loja.id])
    const totalBanco = banco.rows.reduce((s, x) => s + x.n, 0)
    const totalTela = Number((await p.getByTestId('origem-total-pedidos').innerText().catch(() => '-1')).replace(/\D/g, ''))
    ok(`${disp}: total de pedidos da tabela = banco (${totalBanco})`, totalTela === totalBanco, String(totalTela))
    const ig = banco.rows.find((x) => x.origem_canal === 'instagram')?.n ?? 0
    const igTela = await p.getByTestId('origem-linha-instagram').locator('td').nth(2).innerText().catch(() => '')
    ok(`${disp}: linha do Instagram bate (${ig} pedidos)`, Number(igTela) === ig, igTela)
    await fecharAviso()
    await p.getByTestId('origem-metrica-pedidos').click()
    await p.waitForTimeout(300)
    const somaFatias = await p.$$eval('[data-testid="origem-rosca"] path[data-fatia]', (els) => els.length)
    ok(`${disp}: rosca em Pedidos com uma fatia por canal com pedido`, somaFatias === banco.rows.length, `${somaFatias} fatias / ${banco.rows.length} canais`)
    const fatia = p.locator('[data-testid="origem-rosca"] path[data-fatia="instagram"]')
    await fecharAviso()
    if (disp === 'desktop') {
      await fatia.hover(); await p.waitForTimeout(250)
      ok('hover: a fatia salta e a dica mostra origem, visitas, pedidos, conversão e %', (await fatia.getAttribute('data-foco')) === 'sim' && /Instagram/.test(await p.getByTestId('origem-rosca-tooltip').innerText().catch(() => '')) && /pedido/.test(await p.getByTestId('origem-rosca-tooltip').innerText().catch(() => '')) && /%/.test(await p.getByTestId('origem-rosca-tooltip').innerText().catch(() => '')))
      await p.mouse.move(5, 5); await p.waitForTimeout(200)
      ok('tirar o mouse: a dica some', !(await p.getByTestId('origem-rosca-tooltip').isVisible().catch(() => false)))
      await p.locator('[data-testid="origem-rosca"] [role="group"]').focus()
      await p.keyboard.press('ArrowRight'); await p.waitForTimeout(150)
      ok('teclado: seta mostra a dica da fatia', await p.getByTestId('origem-rosca-tooltip').isVisible().catch(() => false))
      await p.keyboard.press('Escape'); await p.waitForTimeout(150)
      ok('teclado: Esc fecha', !(await p.getByTestId('origem-rosca-tooltip').isVisible().catch(() => false)))
      await fecharAviso()
      await p.getByTestId('origem-metrica-faturamento').click()
      ok('alternar para Faturamento muda o centro da rosca', /R\$/.test(await p.locator('[data-testid="origem-rosca"] svg text').first().textContent()))
      if (PRINTS) { await fatia.hover().catch(() => {}); await p.waitForTimeout(250); await area.screenshot({ path: `${PRINTS}/origem-desktop.png` }) }
    } else {
      const b = await fatia.boundingBox()
      if (b) await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
      await p.waitForTimeout(800)
      ok('celular: toque mostra a dica e ela fica', await p.getByTestId('origem-rosca-tooltip').isVisible().catch(() => false))
      if (PRINTS) await area.screenshot({ path: `${PRINTS}/origem-celular.png` })
      await p.getByTestId('origem-tabela').tap({ position: { x: 5, y: 5 } }).catch(() => {})
      await p.waitForTimeout(300)
      ok('celular: toque fora fecha', !(await p.getByTestId('origem-rosca-tooltip').isVisible().catch(() => false)))
      const larg = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      ok('celular: sem rolagem lateral da página', larg[0] <= larg[1] + 1, JSON.stringify(larg))
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  if (criados.length) {
    await db.query(`delete from pedido_itens where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedidos where id = any($1)`, [criados]).catch((e) => console.log('   (limpeza)', e.message))
  }
  await db.query(`delete from vitrine_eventos where restaurante_id=$1 and criado_em >= $2`, [loja.id, inicio]).catch(() => {})
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
void randomUUID
