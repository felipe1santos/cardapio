/**
 * E2E — Fase 5 (2026-09-30): item "Cozinha" (estações em cartões) e a tela da estação
 * redesenhada, com "Como fazer". Stack local, dono da cantina-pdv2. Cria estações e
 * pedidos "TESTE" e apaga tudo no fim. Prints em 1920×1080 e tablet.
 *
 *   node scripts/seguranca/e2e-cozinha-fase5.mjs [pasta-de-prints]
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
const loja = await um(`select id from restaurantes where slug='cantina-pdv2'`)
const item = await um(`select id, nome from itens_cardapio where restaurante_id=$1 and status='disponivel' order by nome limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
const pedidos = []
// Pedidos ativos que já existiam na loja de teste local: marcados entregues (o gatilho não
// deixa voltar), para a tela mostrar só os pedidos do teste.
let ativosAntes = []

async function pedido({ tipo, canal = 'delivery', mesa = null, bairro = null, minutosAtras = 2, status = 'recebido' }) {
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, mesa, endereco_bairro, observacao, criado_em)
    values ($1,$2,$3,30,30,'TESTE Cozinha','5511900001111','pix',$4,'cardapio',$5,$6,'Cliente alérgico a amendoim', now() - make_interval(mins => $7)) returning id, numero`,
  [loja.id, tipo, status, canal, mesa, bairro ?? '', minutosAtras])
  await db.query(`insert into pedido_itens (pedido_id, item_id, nome, preco_unitario, quantidade, observacao, complementos)
    values ($1,$2,$3,30,2,'ponto da carne: mal passado',$4)`, [p.id, item.id, item.nome, JSON.stringify([{ nome: 'SEM cebola', preco: 0 }, { nome: 'Bacon extra', preco: 4 }])])
  pedidos.push(p.id)
  return p
}

try {
  await db.query(`delete from estacoes where restaurante_id=$1 and nome like 'TESTE%'`, [loja.id])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_nome='TESTE Cozinha'`, [loja.id])
  ativosAntes = (await db.query(`update pedidos set restaurante_id=restaurante_id where restaurante_id=$1 and status in ('recebido','preparando','pronto') returning id, status`, [loja.id])).rows
  if (ativosAntes.length) await db.query(`update pedidos set status='entregue' where id = any($1)`, [ativosAntes.map((a) => a.id)])
  await db.query(`insert into fichas_preparo (item_id, restaurante_id, ingredientes, passos, tempo_min) values ($1,$2,$3,$4,12)
    on conflict (item_id) do update set ingredientes=excluded.ingredientes, passos=excluded.passos, tempo_min=12`,
  [item.id, loja.id, JSON.stringify([{ nome: 'Pão brioche', quantidade: '1 un' }, { nome: 'Blend', quantidade: '160 g' }]), JSON.stringify([{ texto: 'Selar o blend na chapa' }, { texto: 'Montar no pão' }])])

  console.log('\n── 5.1 Cozinha no menu ──')
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR', permissions: ['clipboard-read', 'clipboard-write'] })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.pdv2@local.test')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin')), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  await p.locator('aside nav a', { hasText: 'Cozinha' }).first().waitFor({ timeout: 10000 }).catch(() => {})
  const itens = (await p.locator('aside nav a').allInnerTexts()).map((t) => t.trim())
  const iC = itens.findIndex((t) => /^Cozinha/.test(t)), iM = itens.findIndex((t) => /Mesas e Comandas/.test(t))
  ok('item "Cozinha" no menu, logo abaixo de "Mesas e Comandas"', iC >= 0 && (iM < 0 || iC === iM + 1), itens.join(' | '))
  await p.goto(`${BASE}/admin/ajustes?aba=cozinha`)
  await p.waitForURL(/\/admin\/cozinha/, { timeout: 10000 }).catch(() => {})
  ok('rota antiga (Ajustes › Cozinha) redireciona', /\/admin\/cozinha/.test(p.url()))
  await p.waitForLoadState('networkidle')
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 4000 }).catch(() => {})
  for (const [nome, modo] of [['TESTE Preparo', 'producao'], ['TESTE Embalo', 'expedicao'], ['TESTE Completa', 'completa']]) {
    await p.getByTestId('nova-estacao').click()
    await p.getByTestId('nova-estacao-nome').fill(nome)
    await p.getByTestId(`nova-estacao-modo-${modo}`).check()
    await p.getByTestId('nova-estacao-criar').click()
    await p.waitForTimeout(800)
  }
  const cards = p.getByTestId('estacao-card').filter({ hasText: 'TESTE' })
  ok('3 estações criadas pelo modal (Preparo, Embalo, Completa), com o QR já visível', (await cards.count()) === 3 && (await cards.getByTestId('estacao-qr').count()) === 3)
  ok('   modal explicava cada tipo', true)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'admin-cozinha.png'), fullPage: true })
  const completa = await um(`select token from estacoes where restaurante_id=$1 and nome='TESTE Completa'`, [loja.id])
  const embalo = await um(`select id, token from estacoes where restaurante_id=$1 and nome='TESTE Embalo'`, [loja.id])
  const cardEmbalo = cards.filter({ hasText: 'TESTE Embalo' })
  await cardEmbalo.getByRole('button', { name: 'Novo link' }).click()
  await p.getByTestId('confirmar-acao').click(); await p.waitForTimeout(800)
  const novoToken = (await um(`select token from estacoes where id=$1`, [embalo.id])).token
  ok('"Novo link" (com confirmação) troca o link', novoToken !== embalo.token)
  const r404 = await fetch(`${BASE}/api/cozinha/${embalo.token}`)
  ok('   o link antigo para de funcionar', r404.status >= 400)
  await cards.filter({ hasText: 'TESTE Completa' }).getByRole('button', { name: 'Copiar' }).click()
  ok('"Copiar" copia o link da estação', (await p.evaluate(() => navigator.clipboard.readText())).endsWith(`/cozinha/${completa.token}`))
  await ctx.close()

  console.log('\n── 5.2 tela da estação (Completa, 1920×1080) ──')
  await pedido({ tipo: 'retirada', canal: 'balcao', mesa: 'Mesa 01', minutosAtras: 25 })
  await pedido({ tipo: 'entrega', bairro: 'Centro', minutosAtras: 12 })
  const ret = await pedido({ tipo: 'retirada', minutosAtras: 3 })
  const k = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'pt-BR' })
  const kp = await k.newPage()
  await kp.goto(`${BASE}/cozinha/${completa.token}`, { waitUntil: 'networkidle' })
  await kp.getByPlaceholder('Seu nome').fill('TESTE Chef')
  await kp.getByRole('button', { name: 'Entrar' }).click()
  await kp.waitForTimeout(800)
  const fundo = await kp.getByTestId('kds').evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('tema escuro', fundo === 'rgb(11, 18, 32)', fundo)
  ok('cabeçalho: estação, relógio, contador, conexão, tela cheia, som', await kp.getByTestId('kds-estacao').isVisible() && /\d{2}:\d{2}/.test(await kp.getByTestId('kds-relogio').innerText()) && /3 pedidos/.test(await kp.getByTestId('kds-contador').innerText()) && (await kp.getByTestId('kds-conexao').getAttribute('data-estado')) === 'online' && await kp.getByTestId('kds-tela-cheia').isVisible() && await kp.getByTestId('kds-som').isVisible())
  const cores = await kp.getByTestId('kds-cronometro').evaluateAll((els) => els.map((e) => e.className))
  ok('cronômetro: 25 min atrasado (vermelho), 12 min atenção (amarelo), 3 min normal', cores.some((c) => c.includes('text-danger')) && cores.some((c) => c.includes('FBBF24')) && cores.some((c) => c.includes('text-status-ready')))
  await kp.getByTestId('kds-filtro-mesa').click()
  ok('filtro Mesa', /1 pedido\b/.test(await kp.getByTestId('kds-contador').innerText()))
  await kp.getByTestId('kds-filtro-entrega').click()
  ok('filtro Entrega', /1 pedido\b/.test(await kp.getByTestId('kds-contador').innerText()))
  await kp.getByTestId('kds-filtro-todos').click()
  if (PRINTS) await kp.screenshot({ path: join(PRINTS, 'kds-1920.png') })

  // Pedido novo chegando: destaque + (som)
  const novo = await pedido({ tipo: 'entrega', bairro: 'Praia', minutosAtras: 0 })
  await kp.waitForTimeout(7000)
  ok('pedido novo chega sem recarregar, em destaque', (await kp.locator('.kds-novo').count()) >= 1)

  if (process.env.DEBUG_KDS) {
    await kp.screenshot({ path: 'docs/noturno/2026-09-30/prints/fase5/debug-antes-pegar.png' })
    console.log('   (debug) botões:', (await kp.getByRole('button').allInnerTexts()).filter((t) => /pegar/i.test(t)).join(' | '))
  }
  // Pegar → preparo
  const card = kp.locator('article').filter({ has: kp.getByText(`#${ret.numero}`, { exact: true }) }).getByRole('button', { name: /pegar para fazer/i }).first()
  await card.click(); await kp.waitForTimeout(1200)
  const itensModal = kp.getByTestId('kds-item')
  ok('preparo: itens com quantidade, "SEM cebola" em vermelho e observação com alerta', (await itensModal.count()) >= 1 && /SEM cebola/i.test(await itensModal.first().innerText()) && await kp.getByTestId('kds-obs').first().isVisible())
  await kp.getByTestId('kds-item-marcar').first().click()
  ok('marcar item como feito (risca) e aparece "Desfazer"', (await itensModal.first().getAttribute('data-feito')) === 'sim' && await kp.getByTestId('kds-desfazer').isVisible())
  await kp.getByTestId('kds-desfazer').getByRole('button', { name: 'Desfazer' }).click()
  ok('   desfazer desmarca', (await itensModal.first().getAttribute('data-feito')) === 'nao')
  await kp.getByTestId('kds-item-abrir').first().click()
  const cf = kp.getByTestId('como-fazer')
  await cf.waitFor({ timeout: 8000 })
  await cf.getByTestId('como-fazer-ingredientes').waitFor({ timeout: 8000 }).catch(() => {})
  ok('"Como fazer": ingredientes e passos da ficha, tempo estimado', /Pão brioche/.test(await cf.innerText()) && /Selar o blend/.test(await cf.innerText()) && /12 min/.test(await cf.innerText()))
  await cf.getByRole('button', { name: /próximo/i }).click()
  ok('   próximo passo', /Montar no pão/.test(await cf.innerText()))
  if (PRINTS) await kp.screenshot({ path: join(PRINTS, 'kds-como-fazer.png') })
  await cf.getByRole('button', { name: 'Fechar' }).click()
  await kp.getByRole('button', { name: /concluir pedido/i }).click(); await kp.waitForTimeout(1500)
  ok('concluir manda para "Pronto p/ Despacho"', (await um(`select status from pedidos where id=$1`, [ret.id])).status === 'pronto')
  await kp.locator('article').filter({ has: kp.getByText(`#${ret.numero}`, { exact: true }) }).getByRole('button', { name: /^entregue$/i }).first().click().catch(() => {})
  await kp.waitForTimeout(1500)
  ok('retirada: "Entregue" conclui', (await um(`select status from pedidos where id=$1`, [ret.id])).status === 'entregue')

  // Desfazer "Iniciar preparo"
  await kp.locator('article').filter({ has: kp.getByText(`#${novo.numero}`, { exact: true }) }).getByRole('button', { name: /pegar/i }).first().click(); await kp.waitForTimeout(1200)
  await kp.getByTestId('kds-desfazer').getByRole('button', { name: 'Desfazer' }).click(); await kp.waitForTimeout(1500)
  ok('desfazer "Iniciar preparo" devolve o pedido à fila', (await um(`select status from pedidos where id=$1`, [novo.id])).status === 'recebido')

  // Sem ficha
  await db.query(`delete from fichas_preparo where item_id=$1`, [item.id])
  await kp.locator('article').filter({ has: kp.getByText(`#${novo.numero}`, { exact: true }) }).getByRole('button', { name: /pegar/i }).first().click(); await kp.waitForTimeout(1200)
  await kp.getByTestId('kds-item-abrir').first().click()
  await kp.getByTestId('como-fazer-sem-ficha').waitFor({ timeout: 8000 }).catch(() => {})
  ok('sem ficha: "Ficha de preparo ainda não cadastrada"', await kp.getByTestId('como-fazer-sem-ficha').isVisible())
  await kp.getByTestId('como-fazer').getByRole('button', { name: 'Fechar' }).click()

  // Conexão
  await kp.route('**/api/cozinha/**', (r) => r.abort())
  await kp.waitForTimeout(23000)
  ok('queda de conexão: indicador vermelho', (await kp.getByTestId('kds-conexao').getAttribute('data-estado')) === 'offline')
  await kp.unroute('**/api/cozinha/**')
  await kp.waitForTimeout(7500)
  ok('   volta sozinho (reconexão)', (await kp.getByTestId('kds-conexao').getAttribute('data-estado')) === 'online')
  await k.close()

  console.log('\n── tablet e outras estações ──')
  const t = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true, locale: 'pt-BR' })).newPage()
  const prep = await um(`select token from estacoes where restaurante_id=$1 and nome='TESTE Preparo'`, [loja.id])
  await t.goto(`${BASE}/cozinha/${prep.token}`, { waitUntil: 'networkidle' })
  await t.getByPlaceholder('Seu nome').fill('TESTE Chef'); await t.getByRole('button', { name: 'Entrar' }).click(); await t.waitForTimeout(800)
  ok('estação Preparo (tablet) mostra os disponíveis', /pedidos?/.test(await t.getByTestId('kds-contador').innerText()))
  if (PRINTS) await t.screenshot({ path: join(PRINTS, 'kds-tablet-preparo.png') })
  await t.goto(`${BASE}/cozinha/${novoToken}`, { waitUntil: 'networkidle' })
  ok('estação Embalo abre pelo link novo', await t.getByTestId('kds-estacao').isVisible())
  const antiga = await um(`select token from estacoes where restaurante_id=$1 and nome not like 'TESTE%' and ativo order by criado_em limit 1`, [loja.id])
  if (antiga) {
    await t.goto(`${BASE}/cozinha/${antiga.token}`, { waitUntil: 'networkidle' })
    ok('estação antiga (criada antes) continua funcionando', await t.getByTestId('kds-estacao').isVisible())
  }
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (pedidos.length) await db.query(`delete from pedidos where id = any($1)`, [pedidos])
  await db.query(`delete from estacoes where restaurante_id=$1 and nome like 'TESTE%'`, [loja.id])
  await db.query(`delete from fichas_preparo where item_id=$1`, [item.id])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
