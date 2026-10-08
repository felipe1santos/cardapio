/**
 * E2E — item 59 (2026-10-07): app do motoboy novo + QR da rota na comanda. Stack LOCAL, loja
 * fin-int (financeiro ligado). Celular emulado (Pixel 7, 412 px) com câmera falsa; o leitor do
 * navegador (BarcodeDetector) é trocado por um que devolve o texto que o teste "mostra" à câmera —
 * o resto (câmera, laço de leitura, API, pegar) é o caminho real.
 *   · tela inicial: topo escuro (menu, logo, motoboy), Realizadas/Aguardando/Em rota, atalhos,
 *     Atualizar e Sair; peso ≤ 600; alvos de toque ≥ 44 px;
 *   · QR: pegar (com auditoria via qr, aviso ao cliente), já é seu, bloqueios (outra loja, outro
 *     motoboy, cancelado, em preparo, retirada, pausado, despacho fechado), link adulterado,
 *     número digitado; 3 leituras → "Abrir rota com 3 paradas" na ordem a partir da loja;
 *   · /r/<código>: sem sessão → cardápio; motoboy logado → app; adulterado → 404;
 *   · financeiro: troco do pedido pego pelo QR aparece para o operador registrar, como sempre;
 *   · fim: pedidos de TESTE fechados como "Não entregue" pelo app.
 *   node scripts/item59/e2e-motoboy-qr.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.env.PRINTS ?? 'C:/Users/felipe/Downloads/revisao-motoboy'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
let falhas = 0, total = 0
const ok = (n, c, d = '') => { total++; if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const RAND = Math.random().toString(36).slice(2, 7)
const SENHA = 'demo-local-123456'
const SENHA_MOTO = 'moto-teste-5959'

// Mesmo código do servidor (lib/motoboy/qr-rota.ts) — prova que a chave é a mesma.
const chaveQr = createHash('sha256').update(`menuzia:qr-rota:${process.env.QR_ROTA_CHAVE ?? SERVICE_KEY}`).digest()
const codigo = (id) => { const b = Buffer.from(id.replace(/-/g, ''), 'hex'); return Buffer.concat([b, createHmac('sha256', chaveQr).update(b).digest().subarray(0, 10)]).toString('base64url') }
const urlQr = (id) => `https://app.menuzia.com.br/r/${codigo(id)}`

const SLUG = 'fin-int'
const loja = await um(`select id, status_loja, despacho_aberto, latitude, longitude, logo_url from restaurantes where slug=$1`, [SLUG])
const viz = await um(`select id from restaurantes where slug='fin-int-viz'`)
if (!loja || !viz) { console.error('Rode antes a semente da fin-int.'); process.exit(2) }
const LOJA_COORD = { lat: -20.3155, lng: -40.3128 }
await db.query(`update restaurantes set status_loja='aberto_manual', despacho_aberto=true, entrega_sem_entregador=false, latitude=$2, longitude=$3 where id=$1`, [loja.id, LOJA_COORD.lat, LOJA_COORD.lng])
await db.query(`update entregadores set desativado_em=now(), status='offline' where restaurante_id=$1 and nome like 'TESTE Moto 59%'`, [loja.id])
const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 5 order by preco limit 1`, [loja.id])
const criados = []
async function delivery(nome, { trocoPara = null, status = 'pronto', coord = null } = {}) {
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: `TESTE ${nome}`, telefone: '27999990059' }, pagamento: trocoPara ? 'dinheiro' : 'pix', trocoPara,
    endereco: { rua: `Rua Teste ${nome}`, numero: '59', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' },
    itens: [{ itemId: item.id, quantidade: 1, complementos: [] }],
  }) })
  const j = await r.json().catch(() => null)
  if (r.status !== 201) throw new Error(`pedido ${nome}: ${r.status} ${j?.error}`)
  criados.push(j.id)
  await db.query(`update pedidos set status=$2, entrega_latitude=$3, entrega_longitude=$4 where id=$1`, [j.id, status, coord?.lat ?? null, coord?.lng ?? null])
  return um(`select id, numero, total from pedidos where id=$1`, [j.id])
}
async function inserir(restId, tipo, status, entregadorId = null) {
  const p = await um(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, cliente_nome, cliente_telefone, forma_pagamento, canal, origem, observacao, endereco_rua, endereco_numero, endereco_bairro, entregador_id, criado_em, preparando_notificado)
    values ($1,$2,$3,30,30,'TESTE 59 direto','27999990059','pix','delivery','cardapio','','Rua Teste 59','1','Centro',$4, now(), true) returning id, numero`, [restId, tipo, status, entregadorId])
  criados.push(p.id)
  return p
}

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
let sair = async () => {}
try {
  // Dono (API do painel) e os motoboys de teste.
  const dctx = await browser.newContext({ locale: 'pt-BR' })
  const dp = await dctx.newPage()
  await dp.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await dp.fill('input[name="email"]', 'dono.finint'); await dp.fill('input[name="password"]', SENHA)
  await Promise.all([dp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), dp.click('button[type="submit"]')])
  const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => { const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined }); return { s: r.status, j: await r.json().catch(() => null) } }, { url, metodo, corpo })
  const mA = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'TESTE Moto 59 A ' || $2, '27999990059', 'online') returning id, token`, [loja.id, RAND])
  const mB = await um(`insert into entregadores (restaurante_id, nome, telefone, status) values ($1, 'TESTE Moto 59 B ' || $2, '27999990058', 'online') returning id, token`, [loja.id, RAND])
  const login = `moto59a${RAND}`
  const cl = await api(dp, `/api/admin/entregadores/${mA.id}`, 'POST', { acao: 'criar_login', usuario: login, senha: SENHA_MOTO })
  ok('login do motoboy de teste criado', cl.s === 200, `${cl.s} ${cl.j?.error ?? ''}`)

  // Pedidos de TESTE: 3 prontos em pontos conhecidos (ordem esperada a partir da loja: perto → meio → longe).
  const longe = await delivery('59 Longe', { coord: { lat: -20.2700, lng: -40.3000 } })
  const perto = await delivery('59 Perto', { coord: { lat: -20.3170, lng: -40.3120 }, trocoPara: 100 })
  const meio = await delivery('59 Meio', { coord: { lat: -20.3000, lng: -40.3050 } })
  const preparo = await delivery('59 Preparo', { status: 'preparando' })
  const cancel = await delivery('59 Cancelado', { status: 'cancelado' })
  const extra = await delivery('59 Extra')
  const retirada = await inserir(loja.id, 'retirada', 'pronto')
  const deOutro = await inserir(loja.id, 'entrega', 'em_rota', mB.id)
  const outraLoja = await inserir(viz.id, 'entrega', 'pronto')

  // Celular do motoboy: câmera falsa + leitor que devolve o que o teste mostrar.
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', permissions: ['camera'], serviceWorkers: 'block' })
  await ctx.addInitScript(() => {
    window.__qr = null
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code'] } async detect() { const t = window.__qr; if (t) { window.__qr = null; return [{ rawValue: t }] } return [] } }
  })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA_MOTO)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/motoboy'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  sair = async () => { await ctx.close().catch(() => {}) }
  await p.getByTestId('motoboy-inicio').waitFor({ timeout: 15000 })

  secao('1. Tela inicial')
  const topo = await p.locator('header').textContent()
  ok('topo: nome da loja e do motoboy', topo.includes(`TESTE Moto 59 A ${RAND}`) && /Cantina E2E/.test(topo), topo.replace(/\n/g, ' | ').slice(0, 160))
  ok('topo escuro (fundo da barra lateral)', (await p.locator('header').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(17, 24, 39)')
  ok('botão de menu no topo', await p.getByTestId('motoboy-menu').isVisible())
  const n = async (id) => Number(await p.getByTestId(id).innerText())
  ok('3 números: Realizadas, Aguardando, Em rota (zerados)', /Realizadas/.test(topo) && /Aguardando/.test(topo) && /Em rota/.test(topo) && (await n('motoboy-n-aguardando')) === 0 && (await n('motoboy-n-em-rota')) === 0)
  ok('atalhos Entregas, Histórico e Ler QR Code', await p.getByTestId('motoboy-card-entregas').isVisible() && await p.getByTestId('motoboy-card-historico').isVisible() && await p.getByTestId('motoboy-card-qr').isVisible())
  ok('"Atualizar" azul e "Sair" vermelho no fim', (await p.getByTestId('motoboy-atualizar').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(6, 136, 212)' && (await p.getByTestId('motoboy-sair').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(239, 68, 68)')
  const pesos = await p.evaluate(() => [...document.querySelectorAll('[data-testid="motoboy-app"] *')].map((e) => Number(getComputedStyle(e).fontWeight)).filter((w) => w > 600).length)
  ok('peso da fonte ≤ 600 em toda a tela', pesos === 0, String(pesos))
  const pequenos = await p.evaluate(() => [...document.querySelectorAll('[data-testid="motoboy-app"] button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length)
  ok('alvos de toque ≥ 44 px', pequenos === 0, String(pequenos))
  ok('sem rolagem horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await p.setViewportSize({ width: 390, height: 844 })
  await p.screenshot({ path: join(PRINTS, '01-inicio-390.png'), fullPage: true })
  await p.getByTestId('motoboy-menu').click()
  await p.screenshot({ path: join(PRINTS, '02-menu-390.png') })
  await p.getByTestId('motoboy-menu').click()

  secao('2. Ler QR Code: câmera e pegar')
  await p.getByTestId('motoboy-card-qr').click()
  ok('pede a câmera com texto claro antes', /permissão para usar a câmera/.test(await p.getByTestId('motoboy-camera-pedir').innerText()))
  await p.screenshot({ path: join(PRINTS, '03-qr-pedir-camera-390.png') })
  await p.getByTestId('motoboy-abrir-camera').click()
  await p.getByTestId('motoboy-camera').waitFor({ timeout: 8000 })
  await p.waitForFunction(() => (document.querySelector('[data-testid="motoboy-camera"] video')?.readyState ?? 0) >= 2, null, { timeout: 8000 }).catch(() => {})
  ok('câmera abre (vídeo ao vivo)', await p.evaluate(() => (document.querySelector('[data-testid="motoboy-camera"] video')?.readyState ?? 0) >= 2))
  const mostrar = async (t) => {
    await p.evaluate((x) => { window.__qr = x }, t)
    await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 8000 })
    await p.waitForTimeout(200)
    return p.getByTestId('motoboy-qr-resultado').textContent()
  }
  const outra = async () => { await p.getByTestId('motoboy-qr-outra').click().catch(() => {}); await p.waitForTimeout(250) }
  for (const [i, ped] of [[1, perto], [2, longe], [3, meio]]) {
    const t = await mostrar(urlQr(ped.id))
    ok(`leitura ${i}: "Pegar esta entrega?" com #${ped.numero}`, /Pegar esta entrega\?/.test(t) && t.includes(`#${ped.numero}`), t.slice(0, 120))
    if (i === 1) await p.screenshot({ path: join(PRINTS, '04-pegar-esta-entrega-390.png') })
    await p.getByTestId('motoboy-qr-pegar').click()
    await p.getByTestId('motoboy-qr-ok').waitFor({ timeout: 8000 }).catch(() => {})
    const db1 = await um(`select status, entregador_id from pedidos where id=$1`, [ped.id])
    ok(`pedido #${ped.numero} vai para ele em rota`, db1.status === 'em_rota' && db1.entregador_id === mA.id, JSON.stringify(db1))
    await outra()
  }
  const aud = await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='pedido.motoboy_pegou' and entidade_id = any($2::uuid[]) and dados->>'via'='qr'`, [loja.id, [perto.id, longe.id, meio.id]]).catch(() => ({ n: -1 }))
  ok('auditoria: 3 "motoboy pegou" via QR', aud.n === 3, JSON.stringify(aud))
  await p.waitForTimeout(1500)
  const wpp = await um(`select count(*)::int n from whatsapp_envios where pedido_id = any($1::uuid[])`, [[perto.id, longe.id, meio.id]]).catch(() => null)
  console.log(`   ℹ️  avisos ao cliente na fila do WhatsApp (simulado): ${wpp?.n ?? '—'} (o mesmo notificarPedido em_rota do despacho)`)
  const t2 = await mostrar(urlQr(perto.id))
  ok('ler de novo um pedido que já é dele: só abre ("já está na sua rota")', /já está na sua rota/.test(t2), t2)
  await outra()

  secao('3. Rota com 3 paradas')
  const rota = p.getByTestId('motoboy-abrir-rota')
  ok('"Abrir rota completa (3 paradas)" (item 61)', /Abrir rota completa \(3 paradas\)/.test(await rota.innerText()))
  const href = new URL(await rota.getAttribute('href'))
  const wp = href.searchParams.get('waypoints')?.split('|') ?? []
  ok('Google Maps: sai da loja, ordem perto → meio → longe', href.searchParams.get('origin') === `${LOJA_COORD.lat},${LOJA_COORD.lng}` && wp[0] === '-20.317,-40.312' && wp[1] === '-20.3,-40.305' && href.searchParams.get('destination') === '-20.27,-40.3', href.toString())
  await p.screenshot({ path: join(PRINTS, '05-rota-3-paradas-390.png'), fullPage: true })

  secao('4. Bloqueios')
  const bloq = async (nome, t, re, cod) => {
    const r = await mostrar(t)
    const c = await p.getByTestId('motoboy-qr-bloqueado').getAttribute('data-codigo').catch(() => null)
    ok(`${nome}: "${r.split('\n')[0]}"`, re.test(r) && (!cod || c === cod), `${c} ${r}`)
    await outra()
  }
  await bloq('outra loja', urlQr(outraLoja.id), /outra loja/, 'outra_loja')
  await bloq('outro motoboy', urlQr(deOutro.id), /outro motoboy/, 'outro_motoboy')
  await bloq('cancelado', urlQr(cancel.id), /cancelado/, 'cancelado')
  await bloq('ainda em preparo', urlQr(preparo.id), /em preparo/, 'em_preparo')
  await p.screenshot({ path: join(PRINTS, '06-bloqueado-em-preparo-390.png') })
  await bloq('retirada não é entrega', urlQr(retirada.id), /não é de entrega/, 'nao_entrega')
  const cod = codigo(extra.id)
  const adulterado = cod.slice(0, 5) + (cod[5] === 'A' ? 'B' : 'A') + cod.slice(6)
  await bloq('link adulterado', `https://app.menuzia.com.br/r/${adulterado}`, /não é de uma comanda/, 'erro')
  await bloq('QR de outra coisa (Instagram)', 'https://instagram.com/loja', /não é de uma comanda/, 'erro')
  await db.query(`update entregadores set status='offline' where id=$1`, [mA.id])
  await p.getByTestId('motoboy-qr-numero').fill(String(extra.numero)); await p.getByTestId('motoboy-qr-buscar').click()
  await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 8000 })
  ok('motoboy pausado: bloqueia com aviso', /pausado/.test(await p.getByTestId('motoboy-qr-resultado').innerText()))
  await outra()
  await db.query(`update entregadores set status='online' where id=$1`, [mA.id])
  await db.query(`update restaurantes set despacho_aberto=false where id=$1`, [loja.id])
  await p.getByTestId('motoboy-qr-buscar').click()
  await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 8000 })
  ok('item 61: pelo QR pode pegar mesmo com o "despacho aberto" desligado', /Pegar esta entrega\?/i.test(await p.getByTestId('motoboy-qr-resultado').innerText()))
  await outra()
  await db.query(`update restaurantes set despacho_aberto=true where id=$1`, [loja.id])
  await p.getByTestId('motoboy-qr-numero').fill('999999'); await p.getByTestId('motoboy-qr-buscar').click()
  await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 8000 })
  ok('número que não existe na loja', /não encontrado na sua loja/.test(await p.getByTestId('motoboy-qr-resultado').innerText()))
  await outra()
  await p.getByTestId('motoboy-qr-numero').fill(String(extra.numero)); await p.getByTestId('motoboy-qr-buscar').click()
  await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 8000 })
  ok('sem câmera: número digitado acha o pedido e oferece pegar', /Pegar esta entrega\?/i.test(await p.getByTestId('motoboy-qr-resultado').innerText()))
  await p.getByRole('button', { name: 'Cancelar' }).click()

  secao('5. Link /r/<código>')
  const semSessao = await fetch(`${BASE}/r/${codigo(extra.id)}`, { redirect: 'manual' })
  ok('item 61: câmera comum (sem sessão) → app do motoboy (login), não a vitrine', semSessao.status === 302 && new URL(semSessao.headers.get('location')).pathname === '/motoboy', `${semSessao.status} ${semSessao.headers.get('location')}`)
  ok('link sem dado pessoal e fora do Google', semSessao.headers.get('x-robots-tag') === 'noindex' && !/TESTE|2799/.test(semSessao.headers.get('location') ?? ''))
  const adult = await fetch(`${BASE}/r/${adulterado}`, { redirect: 'manual' })
  ok('link adulterado → 404 "Link inválido"', adult.status === 404 && /Link inválido/.test(await adult.text()))
  const comSessao = await ctx.request.get(`${BASE}/r/${codigo(extra.id)}`, { maxRedirects: 0 })
  ok('motoboy logado → app do motoboy com o QR', comSessao.status() === 302 && /\/motoboy\?qr=/.test(comSessao.headers().location ?? ''), `${comSessao.status()} ${comSessao.headers().location}`)
  const dSessao = await dctx.request.get(`${BASE}/r/${codigo(extra.id)}`, { maxRedirects: 0 })
  ok('item 61: qualquer sessão → app do motoboy (lá ele confere quem é)', /\/motoboy\?qr=/.test(dSessao.headers().location ?? ''), dSessao.headers().location)
  await p.goto(`${BASE}/motoboy?qr=${codigo(extra.id)}`, { waitUntil: 'networkidle' })
  await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 10000 }).catch(() => {})
  ok('app aberto pelo link: já mostra "Pegar esta entrega?"', /Pegar esta entrega\?/i.test(await p.getByTestId('motoboy-qr-resultado').innerText().catch(() => '')) && !p.url().includes('qr='), p.url())
  await p.getByRole('button', { name: 'Cancelar' }).click()

  secao('6. Financeiro: troco do pedido pego pelo QR')
  const caixa = await api(dp, '/api/admin/caixa')
  const tr = caixa.j?.financeiro?.trocos?.find((t) => t.pedidoId === perto.id)
  ok('operador vê o troco para registrar (mesma regra do despacho)', !!tr && tr.entregadorId === mA.id, JSON.stringify(caixa.j?.financeiro?.trocos ?? caixa.j).slice(0, 200))

  secao('7. Entregas, histórico e encerrar os pedidos de TESTE ("Não entregue")')
  await p.getByTestId('motoboy-voltar').click()
  ok('início: Aguardando 3, Em rota 0', (await n('motoboy-n-aguardando')) === 3 && (await n('motoboy-n-em-rota')) === 0)
  await p.getByTestId('motoboy-card-entregas').click()
  const ordem = await p.locator('[data-testid^="motoboy-pedido-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  ok('lista na ordem da rota (perto, meio, longe)', ordem.join(',') === [perto, meio, longe].map((x) => `motoboy-pedido-${x.numero}`).join(','), ordem.join(','))
  await p.screenshot({ path: join(PRINTS, '07-entregas-390.png'), fullPage: true })
  const card = p.getByTestId(`motoboy-pedido-${perto.numero}`)
  await card.getByTestId('motoboy-sai').click(); await p.waitForTimeout(1200)
  await p.getByTestId('motoboy-voltar').click()
  ok('saiu: Aguardando 2, Em rota 1', (await n('motoboy-n-aguardando')) === 2 && (await n('motoboy-n-em-rota')) === 1)
  for (const ped of [perto, meio, longe]) {
    await p.getByTestId('motoboy-card-entregas').click()
    const c = p.getByTestId(`motoboy-pedido-${ped.numero}`)
    await c.getByTestId('motoboy-nao-entreguei').click()
    await c.getByTestId('motoboy-motivo').fill('TESTE item 59 — pedido de teste')
    await c.getByTestId('motoboy-confirmar-nao-entreguei').click()
    await p.waitForTimeout(1500)
    await p.getByTestId('motoboy-voltar').click()
  }
  const fim = await q(`select numero, status from pedidos where id = any($1::uuid[])`, [[perto.id, meio.id, longe.id]])
  ok('3 pedidos de TESTE encerrados como "Não entregue" pelo app', fim.every((x) => x.status === 'cancelado'), JSON.stringify(fim))
  await p.getByTestId('motoboy-card-historico').click()
  ok('Histórico abre', await p.getByTestId('motoboy-tela-historico').isVisible())
  await p.screenshot({ path: join(PRINTS, '08-historico-390.png'), fullPage: true })
  await p.getByTestId('motoboy-voltar').click()
  await p.getByTestId('motoboy-sair').click()
  await p.getByTestId('motoboy-login').waitFor({ timeout: 15000 }).catch(() => {})
  ok('"Sair" encerra a sessão e volta ao login do app', new URL(p.url()).pathname.startsWith('/motoboy') && await p.getByTestId('motoboy-login').isVisible({ timeout: 10000 }).catch(() => false), p.url())
} catch (e) {
  falhas++; console.error('ERRO', e)
} finally {
  // Pedidos de TESTE que sobraram: fechados; motoboys de teste desativados; loja como estava.
  await db.query(`update pedidos set status='cancelado' where id = any($1::uuid[]) and status not in ('entregue','cancelado')`, [criados])
  await db.query(`update entregadores set desativado_em=now(), status='offline' where restaurante_id=$1 and nome like 'TESTE Moto 59%'`, [loja.id])
  await db.query(`update restaurantes set status_loja=$2, despacho_aberto=$3, latitude=$4, longitude=$5 where id=$1`, [loja.id, loja.status_loja, loja.despacho_aberto, loja.latitude, loja.longitude])
  await sair()
  await browser.close()
  await db.end()
  console.log(`\n${total - falhas}/${total} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`)
  process.exit(falhas ? 1 : 0)
}
