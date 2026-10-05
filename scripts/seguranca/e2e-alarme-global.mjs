/**
 * E2E — alarme de pedido novo em QUALQUER tela do painel (2026-10-04, 0146).
 *   · toca fora do Painel de Pedidos (Cardápio), sem a página do Kanban aberta;
 *   · som bloqueado pelo navegador: aviso grande "Toque aqui para ativar o som" em toda tela, título
 *     da aba piscando com o número do pedido, aviso some no 1º toque e o pedido que esperava toca;
 *   · contagem de bloqueios por loja (alarme_som_bloqueios);
 *   · garçom (sem acesso a Pedidos): nem som nem aviso;
 *   · celular (390 px, toque) e tablet (820 px): aviso visível e liberado pelo toque;
 *   · push do painel: pedido novo da vitrine manda push às assinaturas da loja (provedor simulado),
 *     e não às de outra loja; assinatura expirada (410) é removida.
 * Loja local `ordem-qr-e2e` (semear-cardapio-ordem.mjs). Cria pedidos "TESTE alarme" e apaga no fim.
 *
 *   node scripts/seguranca/e2e-alarme-global.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const SENHA = 'demo-local-123456'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug=$1`, [SLUG])
const vizinha = await um(`select id from restaurantes where slug<>$1 order by criado_em limit 1`, [SLUG])
if (!loja) { console.error('Rode antes semear-cardapio-ordem.mjs'); process.exit(2) }
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const ate = async (f, ms = 30000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await f()) return true; await new Promise((r) => setTimeout(r, 400)) } return false }
const criados = []
async function pedidoNovo() {
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem)
    values ($1,'retirada','recebido',9,9,'TESTE alarme','5511912340991','dinheiro','delivery','cardapio') returning id, numero`, [loja.id])
  criados.push(p.id)
  return p
}
const aceitarTodos = () => db.query(`update pedidos set status='preparando' where restaurante_id=$1 and status='recebido'`, [loja.id])
const alarme = (p) => p.evaluate(() => window.__mzAlarme ?? { tocou: 0, falhas: {}, bloqueado: null })
const contagemBloqueios = async () => (await um(`select coalesce(sum(contagem),0)::int n from alarme_som_bloqueios where restaurante_id=$1`, [loja.id])).n

// Navegador que EXIGE gesto para tocar som (o que bloqueou a Ponto 400).
const chrome = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] })
/**
 * Login num contexto descartável e a sessão (cookies) copiada para um contexto NOVO, onde ninguém
 * clicou em nada: é o caso da Ponto 400 (painel aberto direto, já logado). O Chrome libera o som
 * para o domínio depois de qualquer clique nele — o próprio clique do login liberaria.
 */
async function entrar(login, opcoes = { viewport: { width: 1366, height: 860 } }) {
  const tmp = await chrome.newContext({ locale: 'pt-BR' })
  const lp = await tmp.newPage()
  await lp.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await lp.fill('input[name="email"]', login); await lp.fill('input[name="password"]', SENHA)
  await Promise.all([lp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), lp.click('button[type="submit"]')])
  // Modal de configuração da loja: dispensado aqui (a dispensa fica no localStorage e viaja junto).
  await lp.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' }).catch(() => {})
  await lp.locator('[aria-labelledby="setup-alerta-titulo"]').first().click({ position: { x: 5, y: 5 }, timeout: 4000 }).catch(() => {})
  await lp.waitForTimeout(300)
  const estado = await tmp.storageState()
  await tmp.close()
  const ctx = await chrome.newContext({ ...opcoes, locale: 'pt-BR', storageState: estado })
  // Regra ESTRITA do navegador real (o Chromium de teste às vezes libera sozinho): o áudio só sai
  // de "suspended" depois de um toque/clique/tecla de verdade nesta página.
  await ctx.addInitScript(() => {
    let gesto = false
    const marcar = (e) => { if (e.isTrusted) gesto = true }
    for (const t of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(t, marcar, true)
    const Orig = window.AudioContext
    if (!Orig) return
    const resume = Orig.prototype.resume
    Orig.prototype.resume = function () { return gesto ? resume.call(this) : Promise.resolve() }
    window.AudioContext = class extends Orig {
      constructor(...a) { super(...a); if (!gesto && this.state === 'running') void this.suspend() }
    }
  })
  const p = await ctx.newPage()
  return { ctx, p }
}
/** Abre a tela por navegação nova: sem gesto nesta página, o áudio começa bloqueado. */
async function abrirSemGesto(p, rota) { await p.goto(`${BASE}${rota}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500) }

try {
  await aceitarTodos()

  secao('desktop · Cardápio (fora do Painel de Pedidos)')
  {
    const { ctx, p } = await entrar('dono.ordemqr')
    await abrirSemGesto(p, '/admin/cardapio')
    const titulo0 = await p.title()
    const b0 = await contagemBloqueios()
    const ped = await pedidoNovo()
    // Tudo antes da repetição de 15 s (o Chromium de teste às vezes libera o áudio sozinho nela).
    ok('aviso grande aparece no Cardápio com o som bloqueado', await ate(() => p.getByTestId('som-bloqueado').isVisible().catch(() => false), 12000))
    const titulos = new Set()
    await ate(async () => { titulos.add(await p.title()); return [...titulos].some((t) => t.includes(`#${ped.numero}`)) }, 4000)
    ok('título da aba pisca com o número do pedido', [...titulos].some((t) => t.includes(`#${ped.numero}`)), [...titulos].join(' | '))
    ok('o aviso cita o pedido que espera', (await p.getByTestId('som-bloqueado').innerText().catch(() => '')).includes(`#${ped.numero}`))
    const cor = await p.getByTestId('som-bloqueado').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color, Math.round(e.getBoundingClientRect().height)])
    ok('aviso vivo e grande (vermelho sólido, texto branco, ≥ 56 px)', cor[0] === 'rgb(185, 28, 28)' && cor[1] === 'rgb(255, 255, 255)' && cor[2] >= 56, JSON.stringify(cor))
    const t0 = (await alarme(p)).tocou
    await p.getByTestId('som-bloqueado').click()
    ok('1º clique: aviso some e o pedido que esperava toca', await ate(async () => (await alarme(p)).tocou > t0, 8000) && !(await p.getByTestId('som-bloqueado').isVisible().catch(() => false)), JSON.stringify(await alarme(p)))
    ok('título volta ao normal depois do som liberado (aba visível)', await ate(async () => (await p.title()) === titulo0, 4000), await p.title())
    ok('a falha de som bloqueado somou na contagem da loja', await ate(async () => (await contagemBloqueios()) > b0, 10000), `${b0} → ${await contagemBloqueios()}`)
    // Liberado: o próximo pedido toca direto, ainda fora do Kanban.
    const t1 = (await alarme(p)).tocou
    await pedidoNovo()
    ok('liberado: pedido seguinte toca no Cardápio (tempo real)', await ate(async () => (await alarme(p)).tocou > t1, 25000), JSON.stringify(await alarme(p)))
    // Navegação interna (sem recarregar) mantém o som liberado.
    await p.getByRole('link', { name: 'Clientes' }).first().click().catch(() => {})
    await p.waitForTimeout(1500)
    const t2 = (await alarme(p)).tocou
    await pedidoNovo()
    ok('trocou de tela pelo menu: continua tocando (Clientes)', await ate(async () => (await alarme(p)).tocou > t2, 25000))
    await aceitarTodos()
    await ctx.close()
  }

  secao('desktop · Painel de Pedidos (controles continuam no Kanban)')
  {
    const { ctx, p } = await entrar('dono.ordemqr')
    await abrirSemGesto(p, '/admin/pedidos')
    const ped = await pedidoNovo()
    ok('aviso aparece também no Kanban', await ate(() => p.getByTestId('som-bloqueado').isVisible().catch(() => false), 25000))
    const card = p.locator(`[aria-label="Pedido #${ped.numero}: abrir o painel"]`).first()
    ok('card do pedido pisca em vermelho enquanto o som está bloqueado', await ate(async () => /ring-\[#DC2626\]/.test((await card.getAttribute('class').catch(() => '')) ?? ''), 15000))
    await p.getByTestId('som-bloqueado').click()
    ok('liberou: o card volta ao normal', await ate(async () => !/ring-\[#DC2626\]/.test((await card.getAttribute('class').catch(() => '')) ?? ''), 5000))
    ok('botão de som do Kanban continua lá', await p.getByTestId('kanban-som').isVisible().catch(() => false) || await p.getByTestId('kanban-silenciar').isVisible().catch(() => false))
    await aceitarTodos()
    await ctx.close()
  }

  secao('garçom (sem acesso ao Painel de Pedidos)')
  {
    const { ctx, p } = await entrar('garcom.ordemqr')
    await abrirSemGesto(p, '/admin/mesas')
    await pedidoNovo()
    await p.waitForTimeout(6000)
    ok('garçom não vê o aviso de som', !(await p.getByTestId('som-bloqueado').isVisible().catch(() => false)))
    ok('garçom não toca alarme', ((await alarme(p)).tocou ?? 0) === 0)
    await aceitarTodos()
    await ctx.close()
  }

  for (const [nome, opcoes] of [
    ['celular Android (390 px, toque)', { ...devices['Pixel 7'] }],
    ['tablet (820 px, toque)', { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['Galaxy Tab S4'].userAgent }],
  ]) {
    secao(nome)
    const { ctx, p } = await entrar('dono.ordemqr', opcoes)
    await abrirSemGesto(p, '/admin/dashboard')
    await pedidoNovo()
    const aviso = p.getByTestId('som-bloqueado')
    ok('aviso aparece no topo da tela', await ate(() => aviso.isVisible().catch(() => false), 25000))
    const box = await aviso.boundingBox()
    const larg = await p.evaluate(() => document.documentElement.clientWidth)
    ok('aviso ocupa a largura toda, sem rolagem lateral', box && box.width >= larg - 2 && (await p.evaluate(() => document.documentElement.scrollWidth)) <= larg + 1, `${Math.round(box?.width)} de ${larg}`)
    const t0 = (await alarme(p)).tocou
    await aviso.tap()
    ok('toque no aviso libera e toca', await ate(async () => (await alarme(p)).tocou > t0, 8000) && !(await aviso.isVisible().catch(() => false)))
    await aceitarTodos()
    await ctx.close()
  }

  secao('push do painel (provedor simulado)')
  {
    const arquivo = process.env.PUSH_SIMULADO_ARQUIVO
    const cfg = await fetch(`${BASE}/api/admin/pedidos/push-painel`).then((r) => r.status)
    ok('rota do push do painel exige login', cfg === 401 || cfg === 307 || cfg === 302, String(cfg))
    const endBom = `https://push.exemplo/painel-${Date.now()}`
    const endVelho = `https://push.exemplo/expirada-${Date.now()}`
    const endVizinha = `https://push.exemplo/vizinha-${Date.now()}`
    const dono = await um(`select id from usuarios where restaurante_id=$1 and papel='dono' limit 1`, [loja.id])
    await db.query(`insert into push_painel_assinaturas (restaurante_id, usuario_id, endpoint, p256dh, auth) values ($1,$2,$3,'p','a'),($1,$2,$4,'p','a')`, [loja.id, dono.id, endBom, endVelho])
    if (vizinha) await db.query(`insert into push_painel_assinaturas (restaurante_id, usuario_id, endpoint, p256dh, auth) values ($1,$2,$3,'p','a')`, [vizinha.id, dono.id, endVizinha])
    const antes = arquivo && existsSync(arquivo) ? readFileSync(arquivo, 'utf8').split('\n').length : 0
    // Pedido novo pela vitrine (o caminho real): monta a partir do 1º item disponível da loja.
    const item = await um(`select i.id from itens_cardapio i where i.restaurante_id=$1 and i.status='disponivel' and coalesce(i.preco,0) > 0 limit 1`, [loja.id]).catch(() => null)
    let criou = null
    if (item) {
      const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        tipo: 'retirada', pagamento: 'dinheiro', cliente: { nome: 'TESTE alarme push', telefone: '11912340991' }, itens: [{ itemId: item.id, quantidade: 1, complementos: [] }], endereco: {},
      }) })
      criou = await r.json().catch(() => null)
      if (criou?.id) criados.push(criou.id)
      ok('pedido da vitrine criado', r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(criou).slice(0, 160)}`)
    } else ok('loja tem item para o pedido da vitrine', false)
    const novas = await ate(() => arquivo && existsSync(arquivo) && readFileSync(arquivo, 'utf8').split('\n').length > antes, 10000)
    const linhas = arquivo && existsSync(arquivo) ? readFileSync(arquivo, 'utf8').split('\n').slice(antes - 1).filter(Boolean).map((l) => JSON.parse(l)) : []
    const doBom = linhas.find((l) => l.endpoint === endBom)
    ok('push saiu para o aparelho da loja', novas && !!doBom, JSON.stringify(doBom?.payload ?? null).slice(0, 160))
    ok('push com título do pedido e tag única', doBom && /Pedido novo #\d+/.test(doBom.payload.title) && doBom.payload.tag === 'menuzia-pedido' && doBom.payload.data?.url === '/admin/pedidos')
    ok('push NÃO sai para aparelho de outra loja', !linhas.some((l) => l.endpoint === endVizinha))
    ok('assinatura expirada (410) é removida', await ate(async () => !(await um(`select 1 x from push_painel_assinaturas where endpoint=$1`, [endVelho])), 5000))
    await db.query(`delete from push_painel_assinaturas where endpoint = any($1)`, [[endBom, endVelho, endVizinha]])
  }
} finally {
  await chrome.close()
  if (criados.length) {
    await db.query(`delete from pedido_itens where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedidos where id = any($1)`, [criados]).catch((e) => console.log('   (limpeza)', e.message))
  }
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
