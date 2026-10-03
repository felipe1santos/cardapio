/**
 * E2E — Painel de Pedidos: ícone de avisos, barra de controles e som de pedido novo (2026-10-03).
 * Loja local `ordem-qr-e2e` (semear-cardapio-ordem.mjs). Pedidos TESTE pela vitrine (retirada, dinheiro);
 * no fim todos os pedidos TESTE criados aqui são cancelados.
 *
 * O som é medido pelo contador `window.__mzAlarme.tocou` (cada toque do Web Audio) e pelas falhas
 * registradas (`falhas.autoplay_bloqueado`). O Chrome roda com a política de autoplay "exige gesto",
 * como um navegador normal depois de recarregar.
 *
 *   node scripts/seguranca/e2e-kanban-topo.mjs [pasta-de-prints]
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, firefox } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
const LOG_SERVIDOR = process.env.LOG_SERVIDOR ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const loja = await um(`select id, impressao_aceitar_pedidos_automaticamente auto, usa_logistica from restaurantes where slug=$1`, [SLUG])
if (!loja) { console.error('Rode antes semear-cardapio-ordem.mjs'); process.exit(2) }
const ITEM = await um(`select id from itens_cardapio where restaurante_id=$1 and nome ilike 'Coca Lata%' limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const texto = (v) => JSON.stringify(v)
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))
const criados = []
let seqTel = 0

async function pedidoNovo(nome = 'TESTE Som') {
  const tel = `2799999${String(7100 + (seqTel++ % 900)).padStart(4, '0')}`
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', cliente: { nome, telefone: tel }, pagamento: 'dinheiro', trocoPara: null,
    endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' }, itens: [{ itemId: ITEM.id, quantidade: 1, complementos: [] }],
  }) }).then(async (x) => ({ s: x.status, j: await x.json().catch(() => ({})) }))
  if (r.s !== 201) throw new Error(`pedido: ${r.s} ${r.j?.error}`)
  criados.push(r.j.id)
  return r.j
}
const fecharPendentes = () => db.query(`update pedidos set status='cancelado', cancelado_motivo='teste', cancelado_em=now() where restaurante_id=$1 and status in ('recebido','preparando','pronto','em_rota') and cliente_nome like 'TESTE%'`, [loja.id])
const alarme = (p) => p.evaluate(() => window.__mzAlarme ?? { tocou: 0, falhas: {}, bloqueado: null })
async function ate(fn, ms = 15000) { const fim = Date.now() + ms; while (Date.now() < fim) { if (await fn()) return true; await esperar(400) } return false }

async function logar(nav, opcoes = {}) {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR', ...opcoes })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.ordemqr')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
/** Abre o painel SEM interagir (o novo documento não tem gesto do usuário: som bloqueado). */
async function abrirPainel(p) {
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  await p.getByTestId('topo-controles').waitFor({ timeout: 20000 })
  await esperar(1200)
}

const chrome = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] })
try {
  await db.query(`update restaurantes set impressao_aceitar_pedidos_automaticamente=false where id=$1`, [loja.id])
  await fecharPendentes()

  secao('1. Barra de controles (desktop 1920)')
  const { ctx, p: p0 } = await logar(chrome, { viewport: { width: 1920, height: 1000 } })
  await ctx.grantPermissions(['notifications'])
  await abrirPainel(p0)
  const ids = ['kanban-status-loja', 'kanban-som', 'kanban-aceite', 'kanban-metricas', 'kanban-entregas', 'kanban-tela-cheia', 'kanban-mais']
  const geo = await p0.evaluate((ids) => {
    const c = document.querySelector('[data-testid="topo-controles"]')
    const titulo = document.querySelector('header h1')
    const caixas = ids.map((id) => { const el = document.querySelector(`[data-testid="${id}"]`); const r = el?.getBoundingClientRect(); return r ? { id, x: r.x, w: r.width, h: Math.round(r.height), dentro: c.contains(el), texto: el.textContent.trim().slice(0, 40), title: el.getAttribute('title') ?? '' } : { id, faltando: true } })
    const sistema = [...document.querySelectorAll('header button, header a')].filter((b) => !c.contains(b) && b.getBoundingClientRect().width > 0).map((b) => b.getBoundingClientRect().x)
    return { caixas, depoisDoTitulo: c.getBoundingClientRect().x > titulo.getBoundingClientRect().right, divisor: getComputedStyle(c).borderLeftWidth, sistemaMaisDireita: Math.min(...sistema) > Math.max(...[...c.children].map((e) => e.getBoundingClientRect().right)) }
  }, ids)
  ok('controles logo depois do título, à esquerda, com divisor', geo.depoisDoTitulo && geo.divisor === '1px', texto({ depoisDoTitulo: geo.depoisDoTitulo, divisor: geo.divisor }))
  ok('botões do sistema (impressão, Dúvidas, perfil) à direita, separados', geo.sistemaMaisDireita)
  ok('todos os controles com 44–48 px e ícone + texto', geo.caixas.every((c) => !c.faltando && c.dentro && c.h >= 44 && c.h <= 48 && c.texto.length > 2), texto(geo.caixas.map((c) => [c.id, c.h])))
  const gaps = await p0.evaluate(() => { const f = [...document.querySelector('[data-testid="topo-controles"]').children].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => a.x - b.x); return f.slice(1).map((r, i) => Math.round(r.x - f[i].right)) })
  ok('estado ligado/desligado no tooltip (Som, Aceite, Métricas)', /LIGADO|DESLIGADO/.test(geo.caixas[1].title) && /LIGADO|DESLIGADO/.test(geo.caixas[2].title) && /VISÍVEIS|OCULTAS/.test(geo.caixas[3].title), geo.caixas[1].title.slice(0, 60))
  ok('chip "Ligado/Desligado" visível em Som e Aceite automático', /Ligado|Desligado/.test(geo.caixas[1].texto) && /Ligado|Desligado/.test(geo.caixas[2].texto), `${geo.caixas[1].texto} | ${geo.caixas[2].texto}`)
  ok('sem caixa alta gritante', !(await p0.getByTestId('kanban-aceite').evaluate((b) => getComputedStyle(b).textTransform === 'uppercase')))
  ok('status da loja como seletor (texto + Manual/Automático)', /Recebendo pedidos|Loja fechada/.test(geo.caixas[0].texto) && /Manual|Automático/.test(geo.caixas[0].texto), geo.caixas[0].texto)
  ok('8 px entre os botões', gaps.length > 4 && gaps.every((g) => g === 8), texto(gaps))
  if (PRINTS) await p0.screenshot({ path: join(PRINTS, 'depois-desktop.png') })

  secao('2. Som: painel reaberto sem nenhum clique no site (autoplay bloqueado)')
  // Navegador reaberto com o painel restaurado: só a sessão, nenhum clique neste site nesta aba.
  const estadoSessao = await ctx.storageState()
  await ctx.close()
  const ctxB = await chrome.newContext({ viewport: { width: 1920, height: 1000 }, locale: 'pt-BR', storageState: estadoSessao })
  await ctxB.grantPermissions(['notifications'])
  const p = await ctxB.newPage()
  await abrirPainel(p)
  const a0 = await alarme(p)
  ok('ao abrir sem clique, o navegador bloqueia o som (estado detectado)', a0.bloqueado === true, texto(a0))
  ok('aviso clicável "🔇 Clique aqui para ativar o som dos pedidos" enquanto bloqueado', await p.getByTestId('som-bloqueado').isVisible().catch(() => false))
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'som-bloqueado.png') })
  await pedidoNovo('TESTE Som Bloqueado')
  ok('pedido novo com som bloqueado: falha registrada (autoplay_bloqueado)', await ate(async () => ((await alarme(p)).falhas?.autoplay_bloqueado ?? 0) >= 1), texto(await alarme(p)))
  const t0 = (await alarme(p)).tocou
  // O Chrome de teste às vezes libera o áudio sozinho segundos depois; se o aviso ainda estiver lá, o clique libera.
  const aindaBloqueado = await p.getByTestId('som-bloqueado').isVisible().catch(() => false)
  if (aindaBloqueado) await p.getByTestId('som-bloqueado').click()
  ok(`liberado (${aindaBloqueado ? 'pelo clique no aviso' : 'pelo navegador'}): o pedido que esperava toca e o aviso some`, await ate(async () => (await alarme(p)).tocou > (aindaBloqueado ? t0 : 0), 8000) && !(await p.getByTestId('som-bloqueado').isVisible().catch(() => false)), texto(await alarme(p)))
  if (LOG_SERVIDOR) {
    await esperar(800)
    ok('falha registrada no log do servidor com o motivo', /\[som-pedido\] falha .*autoplay_bloqueado/.test(readFileSync(LOG_SERVIDOR, 'utf8')))
  }
  ok('com pedido esperando, o botão vira "Silenciar"', await p.getByTestId('kanban-silenciar').isVisible())

  secao('3. Dois pedidos juntos, repetição, silenciar e testar som')
  await p.getByTestId('kanban-mais').click()
  await p.getByTestId('kanban-repetir-10').click()
  await p.keyboard.press('Escape')
  await p.locator('header h1').click()
  const t1 = (await alarme(p)).tocou
  await Promise.all([pedidoNovo('TESTE Dois A'), pedidoNovo('TESTE Dois B')])
  ok('dois pedidos ao mesmo tempo = dois toques', await ate(async () => (await alarme(p)).tocou >= t1 + 2, 15000), `${t1} → ${(await alarme(p)).tocou}`)
  const t2 = (await alarme(p)).tocou
  await esperar(23_000)
  const t3 = (await alarme(p)).tocou
  ok('repete a cada 10 s enquanto ninguém aceita (sem o corte antigo de 2 min)', t3 - t2 >= 2, `${t2} → ${t3}`)
  await p.getByTestId('kanban-silenciar').click()
  await esperar(12_000)
  ok('"Silenciar" para a repetição dos que já tocaram', (await alarme(p)).tocou === (await alarme(p)).tocou && (await alarme(p)).tocou - t3 <= 1, `${t3} → ${(await alarme(p)).tocou}`)
  const t4 = (await alarme(p)).tocou
  await pedidoNovo('TESTE Depois do Silenciar')
  ok('depois de silenciar, pedido NOVO toca normalmente', await ate(async () => (await alarme(p)).tocou > t4, 15000))
  await p.getByTestId('kanban-silenciar').click().catch(() => {})
  const t5 = (await alarme(p)).tocou
  await p.getByTestId('kanban-mais').click()
  await p.getByTestId('kanban-testar-som').click()
  ok('"Testar som" toca', await ate(async () => (await alarme(p)).tocou > t5, 3000))

  secao('4. Aba em segundo plano, internet caindo e duas abas')
  await p.evaluate(() => {
    window.__notifs = []
    const N = window.Notification
    window.Notification = class extends N { constructor(t, o) { super(t, o); window.__notifs.push(t) } }
    Object.defineProperty(window.Notification, 'permission', { get: () => 'granted' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  })
  const t6 = (await alarme(p)).tocou
  await pedidoNovo('TESTE Segundo Plano')
  ok('aba escondida: toca e mostra UMA notificação do navegador', await ate(async () => (await alarme(p)).tocou > t6 && (await p.evaluate(() => window.__notifs.length)) === 1, 15000) && (await p.evaluate(() => window.__notifs.length)) === 1, texto(await p.evaluate(() => window.__notifs)))
  await p.evaluate(() => { delete document.hidden; delete document.visibilityState })
  await p.getByTestId('kanban-silenciar').click().catch(() => {})
  await ctxB.setOffline(true)
  const t7 = (await alarme(p)).tocou
  await pedidoNovo('TESTE Sem Internet')
  await esperar(5000)
  const semRede = (await alarme(p)).tocou
  await ctxB.setOffline(false)
  await p.evaluate(() => window.dispatchEvent(new Event('online')))
  ok('internet caiu, entrou pedido, voltou: busca os perdidos e toca', semRede === t7 && await ate(async () => (await alarme(p)).tocou > t7, 15000), `${t7} / sem rede ${semRede} / depois ${(await alarme(p)).tocou}`)
  await p.getByTestId('kanban-silenciar').click().catch(() => {})
  const p2 = await ctxB.newPage()
  await abrirPainel(p2)
  await p2.mouse.click(5, 890)
  await esperar(1500)
  const [u1, u2] = [(await alarme(p)).tocou, (await alarme(p2)).tocou]
  await pedidoNovo('TESTE Duas Abas')
  await esperar(6000)
  const [v1, v2] = [(await alarme(p)).tocou, (await alarme(p2)).tocou]
  ok('duas abas abertas: o pedido toca uma vez só (uma aba)', (v1 - u1) + (v2 - u2) === 1, `aba1 +${v1 - u1}, aba2 +${v2 - u2}`)
  await p2.close()

  secao('5. Som desligado persiste depois de recarregar')
  await fecharPendentes()
  await esperar(9000)
  await p.reload({ waitUntil: 'networkidle' }); await p.locator('header h1').click(); await esperar(1500)
  if (await p.getByTestId('kanban-silenciar').isVisible().catch(() => false)) await p.getByTestId('kanban-silenciar').click()
  await p.getByTestId('kanban-som').click()
  ok('Som desligado', /Desligado/.test(await p.getByTestId('kanban-som').innerText()))
  await p.reload({ waitUntil: 'networkidle' }); await p.getByTestId('kanban-som').waitFor(); await p.locator('header h1').click()
  ok('depois de recarregar continua desligado', /Desligado/.test(await p.getByTestId('kanban-som').innerText()))
  const t8 = (await alarme(p)).tocou
  await pedidoNovo('TESTE Som Desligado'); await esperar(9000)
  ok('com o som desligado, pedido novo não toca', (await alarme(p)).tocou === t8)
  await p.getByTestId('kanban-som').click()
  ok('liga de novo', /Ligado/.test(await p.getByTestId('kanban-som').innerText().catch(() => '')) || (await p.getByTestId('kanban-silenciar').isVisible().catch(() => false)))
  await fecharPendentes()

  secao('6. Ícone de avisos')
  await esperar(9000)
  ok('sem avisos: ícone neutro e sem badge', (await p.getByTestId('avisos-badge').count()) === 0)
  await p.getByTestId('avisos-icone').click()
  ok('painel sem avisos diz que está tudo em dia', await p.getByTestId('avisos-vazio').isVisible())
  await p.keyboard.press('Escape')
  ok('a faixa amarela larga saiu', !(await p.locator('text=/abertos? há mais de 12 horas\\. Marque/').isVisible().catch(() => false)))
  const parA = await pedidoNovo('TESTE Parado A'); const parB = await pedidoNovo('TESTE Parado B'); const parC = await pedidoNovo('TESTE Parado C')
  await db.query(`update pedidos set criado_em = now() - interval '13 hours' where id = any($1)`, [[parA.id, parB.id, parC.id]])
  await p.reload({ waitUntil: 'networkidle' }); await p.locator('header h1').click()
  ok('3 pedidos parados: badge âmbar com 3', await ate(async () => (await p.getByTestId('avisos-badge').innerText().catch(() => '')) === '3', 10000))
  const parD = await pedidoNovo('TESTE Parado D')
  await db.query(`update pedidos set criado_em = now() - interval '13 hours' where id=$1`, [parD.id])
  ok('aviso novo: badge sobe e o ícone pulsa', await ate(async () => (await p.getByTestId('avisos-badge').innerText().catch(() => '')) === '4', 15000) && /animate-pulse/.test(await p.getByTestId('avisos-icone').getAttribute('class')))
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'avisos-icone.png'), clip: { x: 900, y: 0, width: 540, height: 80 } })
  await p.getByTestId('avisos-icone').click()
  ok('painel lista cada pedido parado com Entregue / Não entregue / Cancelar / Ver no kanban', (await p.getByTestId('aviso-pedido').count()) === 4 && (await p.getByTestId('aviso-entregue').count()) === 4)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'avisos-painel.png') })
  const cardA = p.getByTestId('aviso-pedido').filter({ hasText: `#${parA.numero}` })
  await cardA.getByTestId('aviso-ver').click()
  ok('"Ver no kanban" rola até o card e destaca', await ate(async () => (await p.locator(`[data-testid="pedido-${parA.numero}"][data-destaque="1"]`).count()) === 1, 3000))
  await p.getByTestId('avisos-icone').click()
  await p.getByTestId('aviso-pedido').filter({ hasText: `#${parA.numero}` }).getByTestId('aviso-entregue').click()
  ok('"Entregue" conclui o pedido', await ate(async () => (await um(`select status::text s from pedidos where id=$1`, [parA.id])).s === 'entregue'))
  await p.getByTestId('aviso-pedido').filter({ hasText: `#${parB.numero}` }).getByTestId('aviso-nao-entregue').click()
  await p.getByTestId('aviso-nao-entregue-confirmar').click()
  ok('"Não entregue" (com confirmação) cancela como não entregue', await ate(async () => { const r = await um(`select status::text s, cancelado_motivo m from pedidos where id=$1`, [parB.id]); return r.s === 'cancelado' && r.m === 'nao_entregue' }))
  await p.getByTestId('aviso-pedido').filter({ hasText: `#${parC.numero}` }).getByTestId('aviso-cancelar').click()
  ok('"Cancelar" abre a janela de cancelamento com motivo', await p.locator('text=/Cancelar pedido/i').first().isVisible().catch(() => false))
  await p.keyboard.press('Escape'); await p.locator('header h1').click()
  await ctxB.close()

  await fecharPendentes()
  secao('7. Notebook (1440), tablet (1024) e celular (390)')
  for (const [nome, vp, extra] of [['notebook', { width: 1440, height: 900 }, {}], ['tablet', { width: 1024, height: 768 }, { isMobile: true, hasTouch: true }], ['celular', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }]]) {
    const { ctx: c2, p: q2 } = await logar(chrome, { viewport: vp, ...extra })
    await abrirPainel(q2)
    const larg = await q2.evaluate(() => ({ doc: document.documentElement.scrollWidth, vis: window.innerWidth }))
    ok(`${nome}: sem rolagem horizontal da página`, larg.doc <= larg.vis + 1, texto(larg))
    if (nome === 'notebook') {
      const alt = await q2.evaluate(() => { const h = document.querySelector('header'); const t = h.querySelector('h1').getBoundingClientRect(); const s = document.querySelector('[data-testid="topo-controles"]').getBoundingClientRect(); return { h: Math.round(h.getBoundingClientRect().height), mesmaLinha: Math.abs((t.top + t.bottom) / 2 - (s.top + s.bottom) / 2) < 6 } })
      ok('notebook: título, controles e botões do sistema numa linha só', alt.mesmaLinha && alt.h <= 64, texto(alt))
    }
    ok(`${nome}: Métricas/Entregas/Tela cheia vão para "Mais ⋯"`, !(await q2.getByTestId('kanban-metricas').isVisible()) && await q2.getByTestId('kanban-mais').isVisible())
    if (nome === 'notebook') await q2.getByTestId('kanban-mais').click(); else await q2.getByTestId('kanban-mais').tap()
    ok(`${nome}: menu "Mais" tem Testar som, repetição e métricas`, await q2.getByTestId('kanban-testar-som').isVisible() && /métricas/i.test(await q2.getByTestId('kanban-mais-menu').innerText()))
    const mb = await q2.getByTestId('kanban-mais-menu').boundingBox()
    ok(`${nome}: menu "Mais" inteiro dentro da tela`, !!mb && mb.x >= 0 && mb.x + mb.width <= vp.width + 1, texto(mb))
    if (PRINTS) await q2.screenshot({ path: join(PRINTS, `depois-${nome}.png`) })
    await c2.close()
  }
} catch (e) {
  ok('fluxo sem erro', false, String(e).slice(0, 300))
} finally {
  await chrome.close()
}

secao('8. Edge e Firefox (desktop)')
await fecharPendentes()
for (const [nome, lancar] of [['Edge', () => chromium.launch({ channel: 'msedge' })], ['Firefox', () => firefox.launch()]]) {
  let b = null
  try {
    b = await lancar()
    const { p } = await logar(b)
    await abrirPainel(p)
    ok(`${nome}: barra de controles e ícone de avisos`, (await p.getByTestId('kanban-som').isVisible() || await p.getByTestId('kanban-silenciar').isVisible()) && await p.getByTestId('avisos-icone').isVisible())
    await p.locator('header h1').click()
    await p.getByTestId('kanban-mais').click(); await p.getByTestId('kanban-testar-som').click()
    ok(`${nome}: Testar som toca`, await ate(async () => (await alarme(p)).tocou >= 1, 4000), texto(await alarme(p)))
    const t = (await alarme(p)).tocou
    await pedidoNovo(`TESTE ${nome}`)
    ok(`${nome}: pedido novo toca`, await ate(async () => (await alarme(p)).tocou > t, 15000))
  } catch (e) {
    ok(`${nome}: fluxo`, false, String(e).slice(0, 200))
  } finally {
    await b?.close()
    await fecharPendentes()
  }
}

await db.query(`update pedidos set status='cancelado', cancelado_motivo='teste', cancelado_em=now() where id = any($1) and status <> 'cancelado' and status <> 'entregue'`, [criados])
await db.query(`update restaurantes set impressao_aceitar_pedidos_automaticamente=$2 where id=$1`, [loja.id, loja.auto])
await db.end()
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
