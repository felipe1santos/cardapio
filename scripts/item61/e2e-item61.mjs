/**
 * E2E — item 61 (2026-10-08). Stack LOCAL, loja fin-int (financeiro ligado). Servidor com
 * CRON_SECRET=e2e-item61 (o teste chama o cron de entregas).
 *   A. Impressão: só Cozinha e Pré-conta; QR da rota "ROTA DE ENTREGA"; pré-conta com o Instagram
 *      (sem Instagram: sem QR + aviso); nada do QR do cardápio; sem "Via da cozinha"/"Comanda de entrega".
 *   B. "+ Motoboy" no Despacho (nome + senha + telefone) → login criado.
 *   C. QR da comanda pela câmera do celular (sem sessão): /r/<código> → /motoboy?qr → login por nome →
 *      "Pegar esta entrega?" → pegar → "Rota deste pedido" e "Todas as rotas" (ordem inteligente,
 *      "Abrir rota completa"); sessão salva; bloqueios; nada do pedido sem login; acesso pausado.
 *   D. Despacho automático: liga no "⋯" do Kanban (auditado), pedido pronto vai sozinho para quem tem
 *      menos entregas; sem motoboy disponível → aviso no "Despachar"; desligado → contador.
 *   E. Entregue automático (1h30): cron marca, selo, auditoria e o dinheiro fica pendente no acerto.
 *   Fim: pedidos de TESTE encerrados, motoboys de teste desativados, loja como estava.
 *   CRON_SECRET=e2e-item61 node scripts/item61/e2e-item61.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, createHmac } from 'node:crypto'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const CRON = process.env.CRON_SECRET ?? 'e2e-item61'
const PRINTS = join(homedir(), 'Downloads', 'revisao-item61', 'local'); mkdirSync(PRINTS, { recursive: true })
const { DB_URL, SERVICE_KEY } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
let falhas = 0, total = 0
const ok = (n, c, d = '') => { total++; if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const RAND = Math.random().toString(36).slice(2, 6)
const SENHA = 'demo-local-123456'
const chaveQr = createHash('sha256').update(`menuzia:qr-rota:${process.env.QR_ROTA_CHAVE ?? SERVICE_KEY}`).digest()
const codigo = (id) => { const b = Buffer.from(id.replace(/-/g, ''), 'hex'); return Buffer.concat([b, createHmac('sha256', chaveQr).update(b).digest().subarray(0, 10)]).toString('base64url') }

const SLUG = 'fin-int'
const loja = await um(`select id, status_loja, financeiro_ativo, despacho_aberto, despacho_automatico, latitude, longitude, instagram_url, impressao_qr from restaurantes where slug=$1`, [SLUG])
if (!loja) { console.error('Rode antes a semente da fin-int.'); process.exit(2) }
const LOJA_COORD = { lat: -20.3155, lng: -40.3128 }
await db.query(`update restaurantes set status_loja='aberto_manual', despacho_aberto=false, despacho_automatico=false, entrega_sem_entregador=false, latitude=$2, longitude=$3, instagram_url=null, impressao_qr=true where id=$1`, [loja.id, LOJA_COORD.lat, LOJA_COORD.lng])
await db.query(`update entregadores set desativado_em=now(), status='offline' where restaurante_id=$1 and desativado_em is null`, [loja.id])
const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 5 order by preco limit 1`, [loja.id])
const criados = []
async function entrega(nome, { trocoPara = null, status = 'pronto', coord = null } = {}) {
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'entrega', cliente: { nome: `TESTE 61 ${nome}`, telefone: '27999990061' }, pagamento: trocoPara ? 'dinheiro' : 'pix', trocoPara,
    endereco: { rua: `Rua Teste ${nome}`, numero: '61', complemento: '', bairro: 'Centro', cep: '29000000', cidade: 'Vitória' },
    itens: [{ itemId: item.id, quantidade: 1, complementos: [] }],
  }) })
  const j = await r.json().catch(() => null)
  if (r.status !== 201) throw new Error(`pedido ${nome}: ${r.status} ${j?.error}`)
  criados.push(j.id)
  await db.query(`update pedidos set status=$2, entrega_latitude=$3, entrega_longitude=$4 where id=$1`, [j.id, status, coord?.lat ?? null, coord?.lng ?? null])
  return um(`select id, numero, total from pedidos where id=$1`, [j.id])
}
const online = (id) => db.query(`update entregadores set ultimo_acesso_em=now(), status='online' where id=$1`, [id])

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  const dctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1440, height: 900 } })
  const dp = await dctx.newPage()
  await dp.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await dp.fill('input[name="email"]', 'dono.finint'); await dp.fill('input[name="password"]', SENHA)
  await Promise.all([dp.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), dp.click('button[type="submit"]')])
  const api = (url, metodo = 'GET', corpo) => dp.evaluate(async ({ url, metodo, corpo }) => { const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined }); return { s: r.status, j: await r.json().catch(() => null) } }, { url, metodo, corpo })
  const fecharAvisos = async (p) => { for (const t of ['OK, entendi', 'Agora não', 'Depois', 'Fechar']) await p.getByRole('button', { name: t }).first().click({ timeout: 400 }).catch(() => {}) }

  secao('A. Impressão: só Cozinha e Pré-conta, QRs certos')
  let pv = (await api('/api/admin/impressao/previa')).j
  ok('prévia: comanda de entrega com o QR da rota e "ROTA DE ENTREGA"', pv?.qrRota?.origem === 'rota' && pv?.qrRota?.frase === 'ROTA DE ENTREGA' && /\/r\//.test(pv?.qrRota?.url ?? ''), JSON.stringify(pv?.qrRota?.frase))
  ok('sem Instagram: pré-conta sem QR (nunca o do cardápio)', pv?.qr === null && pv?.temInstagram === false && !('qrCardapio' in (pv ?? {})), JSON.stringify({ qr: pv?.qr, ti: pv?.temInstagram }))
  await dp.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' }); await fecharAvisos(dp)
  await dp.getByTestId('passo-3').waitFor({ timeout: 20000 })
  ok('aviso "Cadastre o Instagram da loja…" com link para o Perfil', /Cadastre o Instagram da loja para sair o QR na pré-conta/.test(await dp.getByTestId('aviso-instagram').innerText().catch(() => '')) && (await dp.getByTestId('aviso-instagram').locator('a[href="/admin/ajustes"]').count()) === 1)
  ok('sem a opção "Via da cozinha"; QR é o do Instagram na pré-conta', (await dp.getByTestId('opcao-viaCozinha').count()) === 0 && /QR Code do Instagram na pré-conta/.test(await dp.getByTestId('opcoes-impressao').innerText()))
  await db.query(`update restaurantes set instagram_url='https://instagram.com/cantina_e2e' where id=$1`, [loja.id])
  pv = (await api('/api/admin/impressao/previa')).j
  ok('com Instagram: pré-conta com o QR do Instagram', pv?.qr?.origem === 'instagram' && pv?.qr?.url === 'https://instagram.com/cantina_e2e' && pv?.temInstagram === true)
  await dp.reload({ waitUntil: 'networkidle' }); await fecharAvisos(dp); await dp.getByTestId('passo-3').waitFor({ timeout: 20000 })
  ok('com Instagram: sem o aviso', (await dp.getByTestId('aviso-instagram').count()) === 0)

  secao('B. "+ Motoboy" no Despacho')
  await dp.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await fecharAvisos(dp)
  const despachar = dp.getByTestId('kanban-despachar')
  await despachar.waitFor({ timeout: 20000 })
  await despachar.click()
  await dp.getByTestId('despacho-novo-motoboy').waitFor({ timeout: 15000 })
  const btn = await dp.getByTestId('despacho-novo-motoboy').boundingBox()
  ok('botão "+ Motoboy" no canto superior direito do Despacho', btn && btn.x > 1440 * 0.6 && btn.y < 120, JSON.stringify(btn))
  await dp.getByTestId('despacho-novo-motoboy').click()
  const NOME_A = `Teste Moto Ana ${RAND}`
  await dp.getByTestId('novo-motoboy-nome').fill(NOME_A)
  await dp.getByTestId('novo-motoboy-senha').fill('senha-moto-61')
  await dp.getByTestId('novo-motoboy-telefone').fill('(27) 99999-0061')
  await dp.screenshot({ path: join(PRINTS, 'B1-novo-motoboy.png') })
  await dp.getByTestId('novo-motoboy-salvar').click()
  await dp.getByTestId('novo-motoboy').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const mA = await um(`select e.id, e.usuario_id, e.telefone, u.papel, u.cargo from entregadores e left join usuarios u on u.id=e.usuario_id where e.restaurante_id=$1 and e.nome=$2 and e.desativado_em is null`, [loja.id, NOME_A])
  ok('motoboy criado com login (papel entregador, cargo motoboy) e telefone', !!mA?.usuario_id && mA.papel === 'entregador' && mA.cargo === 'motoboy' && mA.telefone === '27999990061', JSON.stringify(mA))
  const dup = await api('/api/admin/entregadores', 'POST', { nome: NOME_A.toUpperCase(), senha: 'outra-senha-61' })
  ok('nome repetido na loja é recusado', dup.s === 409, `${dup.s}`)
  const curta = await api('/api/admin/entregadores', 'POST', { nome: `Outro ${RAND}`, senha: '123' })
  ok('senha curta é recusada', curta.s === 400, `${curta.s}`)
  const NOME_B = `Teste Moto Bia ${RAND}`
  const cb = await api('/api/admin/entregadores', 'POST', { nome: NOME_B, senha: 'senha-moto-61b' })
  const mB = await um(`select id from entregadores where restaurante_id=$1 and nome=$2`, [loja.id, NOME_B])
  ok('segundo motoboy criado pela API', cb.s === 200 && !!mB, `${cb.s}`)
  await dp.keyboard.press('Escape').catch(() => {})

  secao('C. QR da comanda pela câmera do celular → app do motoboy')
  const perto = await entrega('Perto', { coord: { lat: -20.3170, lng: -40.3120 }, trocoPara: 100 })
  const longe = await entrega('Longe', { coord: { lat: -20.2700, lng: -40.3000 } })
  const meio = await entrega('Meio', { coord: { lat: -20.3000, lng: -40.3050 } })
  const r = await fetch(`${BASE}/r/${codigo(perto.id)}`, { redirect: 'manual' })
  ok('/r/<código> sem sessão → app do motoboy (não a vitrine)', r.status === 302 && new URL(r.headers.get('location')).pathname === '/motoboy' && new URL(r.headers.get('location')).searchParams.get('qr') === codigo(perto.id), `${r.status} ${r.headers.get('location')}`)
  const ruim = await fetch(`${BASE}/r/${codigo(perto.id).slice(0, -2)}xx`, { redirect: 'manual' })
  ok('código adulterado → 404', ruim.status === 404)
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', permissions: ['camera'], serviceWorkers: 'block' })
  await ctx.addInitScript(() => { window.__qr = null; window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code'] } async detect() { const t = window.__qr; if (t) { window.__qr = null; return [{ rawValue: t }] } return [] } } })
  const p = await ctx.newPage()
  // O /r/ aponta para o endereço público; aqui o celular abre o destino dele na stack local.
  await p.goto(`${BASE}/motoboy?qr=${codigo(perto.id)}`, { waitUntil: 'networkidle' })
  await p.getByTestId('motoboy-login').waitFor({ timeout: 15000 })
  const txtLogin = await p.locator('body').innerText()
  ok('sem login: tela de login do app, sem endereço nem cliente', !/Rua Teste|TESTE 61/.test(txtLogin), txtLogin.slice(0, 120))
  await p.screenshot({ path: join(PRINTS, 'C1-login-390.png') })
  await p.getByTestId('motoboy-login-nome').fill(NOME_A); await p.getByTestId('motoboy-login-senha').fill('senha-errada-1')
  await p.getByTestId('motoboy-login-entrar').click()
  ok('senha errada: mensagem clara', /não conferem/.test(await p.getByTestId('motoboy-login-erro').innerText({ timeout: 8000 }).catch(() => '')))
  await p.getByTestId('motoboy-login-nome').fill(`  ${NOME_A.toLowerCase().replace('ana', 'ANA')} `); await p.getByTestId('motoboy-login-senha').fill('senha-moto-61')
  await p.getByTestId('motoboy-login-entrar').click()
  await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 15000 })
  let t = await p.getByTestId('motoboy-qr-resultado').textContent()
  ok('login pelo nome (sem ligar para maiúscula/espaço) → direto no pedido: "Pegar esta entrega?"', /Pegar esta entrega\?/.test(t) && t.includes(`#${perto.numero}`), t.slice(0, 100))
  await p.screenshot({ path: join(PRINTS, 'C1b-pegar-390.png'), fullPage: true })
  await p.getByTestId('motoboy-qr-pegar').click({ timeout: 8000 })
  await p.getByTestId('motoboy-qr-rotas').waitFor({ timeout: 10000 })
  const db1 = await um(`select status, entregador_id from pedidos where id=$1`, [perto.id])
  ok('pegou: pedido em rota com ele (sem depender do "despacho aberto")', db1.status === 'em_rota' && db1.entregador_id === mA.id, JSON.stringify(db1))
  const deste = new URL(await p.getByTestId('motoboy-rota-deste').getAttribute('href'))
  ok('"Rota deste pedido": Google Maps até o endereço do pedido', deste.hostname === 'www.google.com' && deste.searchParams.get('destination') === '-20.317,-40.312', deste.toString())
  ok('dois botões grandes (≥ 52 px)', (await p.getByTestId('motoboy-rota-deste').boundingBox()).height >= 52 && (await p.getByTestId('motoboy-todas-rotas').boundingBox()).height >= 52)
  await p.screenshot({ path: join(PRINTS, 'C2-pedido-com-rotas-390.png'), fullPage: true })
  const ler = async (id) => { await p.getByTestId('motoboy-qr-outra').click().catch(() => {}); await p.waitForTimeout(200); await p.evaluate((x) => { window.__qr = x }, `https://app.menuzia.com.br/r/${codigo(id)}`); await p.getByTestId('motoboy-qr-resultado').waitFor({ timeout: 8000 }); await p.waitForTimeout(200); return p.getByTestId('motoboy-qr-resultado').textContent() }
  if (!(await p.getByTestId('motoboy-camera').count())) { await p.getByTestId('motoboy-abrir-camera').click().catch(() => {}) }
  for (const ped of [longe, meio]) {
    t = await ler(ped.id)
    if (/Pegar esta entrega/.test(t)) { await p.getByTestId('motoboy-qr-pegar').click(); await p.getByTestId('motoboy-qr-rotas').waitFor({ timeout: 8000 }) }
  }
  await p.getByTestId('motoboy-todas-rotas').click()
  await p.getByTestId('motoboy-tela-entregas').waitFor({ timeout: 8000 })
  const completa = p.getByTestId('motoboy-abrir-rota')
  const hr = new URL(await completa.getAttribute('href'))
  const wp = hr.searchParams.get('waypoints')?.split('|') ?? []
  ok('"Todas as rotas": "Abrir rota completa (3 paradas)" na ordem perto → meio → longe', /Abrir rota completa \(3 paradas\)/.test(await completa.innerText()) && wp[0] === '-20.317,-40.312' && wp[1] === '-20.3,-40.305' && hr.searchParams.get('destination') === '-20.27,-40.3', hr.toString())
  await p.getByTestId('motoboy-sai').first().click().catch(() => {})
  await p.waitForFunction(() => /Marcar como entregue/i.test(document.querySelector('[data-testid="motoboy-entregue"]')?.textContent ?? ''), null, { timeout: 10000 }).catch(() => {})
  ok('"Marcar como entregue" no pedido que saiu', /Marcar como entregue/i.test(await p.getByTestId('motoboy-entregue').first().textContent().catch(() => '')))
  await p.screenshot({ path: join(PRINTS, 'C3-todas-as-rotas-390.png'), fullPage: true })
  await p.goto(`${BASE}/motoboy`, { waitUntil: 'networkidle' })
  ok('sessão salva: abrir o app de novo não pede login', await p.getByTestId('motoboy-inicio').isVisible({ timeout: 10000 }).catch(() => false))
  // Bloqueio: pedido com outro motoboy.
  const doB = await entrega('DoB')
  await db.query(`update pedidos set status='em_rota', entregador_id=$2 where id=$1`, [doB.id, mB.id])
  await p.getByTestId('motoboy-card-qr').click()
  if (await p.getByTestId('motoboy-abrir-camera').count()) await p.getByTestId('motoboy-abrir-camera').click()
  t = await ler(doB.id)
  ok('pedido com outro motoboy: bloqueia com mensagem', /já está com outro motoboy/.test(t), t)
  // Entregar um pela tela (financeiro: pagamento já existe).
  // Acesso pausado não entra.
  const ctx2 = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', serviceWorkers: 'block' })
  const p2 = await ctx2.newPage()
  await db.query(`update usuarios set situacao='pausado' where id=(select usuario_id from entregadores where id=$1)`, [mB.id])
  await p2.goto(`${BASE}/motoboy`, { waitUntil: 'networkidle' })
  await p2.getByTestId('motoboy-login').waitFor({ timeout: 15000 })
  await p2.getByTestId('motoboy-login-nome').fill(NOME_B); await p2.getByTestId('motoboy-login-senha').fill('senha-moto-61b')
  await p2.getByTestId('motoboy-login-entrar').click()
  ok('motoboy pausado não entra', /pausado/.test(await p2.getByTestId('motoboy-login-erro').innerText({ timeout: 8000 }).catch(() => '')))
  await db.query(`update usuarios set situacao=null where id=(select usuario_id from entregadores where id=$1)`, [mB.id])
  await ctx2.close()

  secao('D. Despacho automático')
  await dp.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' }); await fecharAvisos(dp)
  await dp.getByTestId('kanban-mais').click().catch(() => {})
  const item = dp.getByTestId('kanban-despacho-automatico')
  ok('"Despacho automático" no menu "⋯" (sem "Despacho aberto")', await item.isVisible({ timeout: 5000 }).catch(() => false) && (await dp.getByTestId('kanban-despacho-aberto').count()) === 0)
  await item.click()
  await dp.waitForTimeout(1200)
  ok('ligou e ficou na auditoria', (await um(`select despacho_automatico d from restaurantes where id=$1`, [loja.id])).d === true && (await um(`select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='loja.despacho_automatico' and dados->>'para'='true'`, [loja.id])).n >= 1)
  await dp.keyboard.press('Escape').catch(() => {})
  // A tem 3 em rota (do item C); B tem 1. Os dois online → o próximo vai para B (menos entregas).
  await online(mA.id); await online(mB.id)
  const auto1 = await entrega('Auto1')
  const rr = await api('/api/admin/despacho/automatico', 'POST', { acao: 'rodar' })
  const a1 = await um(`select status, entregador_id from pedidos where id=$1`, [auto1.id])
  ok('pronto → despachado sozinho para quem tem MENOS entregas (B)', a1.status === 'em_rota' && a1.entregador_id === mB.id, JSON.stringify({ a1, rr: rr.j }))
  ok('auditoria "pedido.despacho_automatico"', (await um(`select count(*)::int n from eventos_auditoria where entidade_id=$1 and acao='pedido.despacho_automatico'`, [auto1.id])).n === 1)
  // Empate: dois livres sem nada em rota → quem saiu há mais tempo. Sem ninguém online → fica pronto + aviso.
  await db.query(`update entregadores set ultimo_acesso_em=now() - interval '10 minutes' where id = any($1::uuid[])`, [[mA.id, mB.id]])
  const auto2 = await entrega('Auto2')
  const rr2 = await api('/api/admin/despacho/automatico', 'POST', { acao: 'rodar' })
  const a2 = await um(`select status, entregador_id from pedidos where id=$1`, [auto2.id])
  ok('sem motoboy disponível: o pedido fica em "Pronto"', a2.status === 'pronto' && !a2.entregador_id && rr2.j?.semMotoboy >= 1, JSON.stringify(rr2.j))
  await dp.reload({ waitUntil: 'networkidle' }); await fecharAvisos(dp)
  await dp.getByTestId('kanban-sem-motoboy').waitFor({ timeout: 15000 }).catch(() => {})
  ok('botão "Despachar" avisa "Sem motoboy disponível"', /Sem motoboy disponível/.test(await dp.getByTestId('kanban-despachar').innerText()))
  await dp.screenshot({ path: join(PRINTS, 'D1-sem-motoboy.png') })
  // Motoboy volta (sinal do app) → o cron de entregas despacha o que ficou esperando.
  await online(mB.id)
  const cr = await fetch(`${BASE}/api/cron/entregas`, { method: 'POST', headers: { 'x-cron-secret': CRON } })
  const a2b = await um(`select status, entregador_id from pedidos where id=$1`, [auto2.id])
  ok('motoboy voltou: o cron despacha o que estava esperando', cr.status === 200 && a2b.status === 'em_rota' && a2b.entregador_id === mB.id, `${cr.status} ${JSON.stringify(a2b)}`)
  // Desligado: nada vai sozinho; o botão mostra o número de prontos de entrega.
  await dp.getByTestId('kanban-mais').click().catch(() => {})
  await dp.getByTestId('kanban-despacho-automatico').click()
  await dp.waitForTimeout(1000)
  await dp.keyboard.press('Escape').catch(() => {})
  const man = await entrega('Manual')
  await api('/api/admin/despacho/automatico', 'POST', { acao: 'rodar' })
  ok('desligado: o pedido pronto não vai sozinho', (await um(`select status from pedidos where id=$1`, [man.id])).status === 'pronto')
  await dp.reload({ waitUntil: 'networkidle' }); await fecharAvisos(dp)
  const cont = Number(await dp.getByTestId('kanban-despachar-contador').innerText({ timeout: 15000 }))
  const esperado = (await um(`select count(*)::int n from pedidos where restaurante_id=$1 and status='pronto' and tipo='entrega' and entregador_id is null and criado_em > now() - interval '1 day'`, [loja.id])).n
  ok('desligado: "Despachar" mostra o número de prontos de entrega', cont >= 1 && cont <= esperado, `${cont} / ${esperado}`)

  secao('E. Entregue automático (1h30)')
  // "perto" é dinheiro (troco p/ 100) com A: em rota há 91 min.
  await db.query(`update pedidos set em_rota_em = now() - interval '91 minutes' where id=$1`, [perto.id])
  await db.query(`update pedidos set em_rota_em = now() - interval '30 minutes' where id=$1`, [meio.id])
  const cr2 = await fetch(`${BASE}/api/cron/entregas`, { method: 'POST', headers: { 'x-cron-secret': CRON } })
  const pe = await um(`select status, entregue_automatico from pedidos where id=$1`, [perto.id])
  ok('1h30 em rota → "Entregue (automático)"', cr2.status === 200 && pe.status === 'entregue' && pe.entregue_automatico === true, JSON.stringify(pe))
  ok('30 min em rota: continua em rota', (await um(`select status from pedidos where id=$1`, [meio.id])).status === 'em_rota')
  ok('auditoria "pedido.entregue_automatico"', (await um(`select count(*)::int n from eventos_auditoria where entidade_id=$1 and acao='pedido.entregue_automatico'`, [perto.id])).n === 1)
  // Financeiro desligado (como a fin-int local): o acerto conta pedido ENTREGUE em dinheiro do motoboy.
  const leg = await um(`select status, forma_pagamento f, pago, entregador_id e from pedidos where id=$1`, [perto.id])
  ok('financeiro desligado: o pedido em dinheiro conta no acerto do motoboy (entregue, não pago)', leg.status === 'entregue' && leg.f === 'dinheiro' && leg.pago === false && leg.e === mA.id, JSON.stringify(leg))
  // Financeiro ligado: vira pendência do motoboy no livro-caixa.
  await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])
  const din = await entrega('Dinheiro', { trocoPara: 50 })
  await db.query(`update pedidos set status='em_rota', entregador_id=$2, em_rota_em=now() - interval '95 minutes' where id=$1`, [din.id, mA.id])
  await fetch(`${BASE}/api/cron/entregas`, { method: 'POST', headers: { 'x-cron-secret': CRON } })
  const pend = await um(`select count(*)::int n, coalesce(sum(valor_centavos),0)::int v from fin_lancamentos where pedido_id=$1 and tipo='pendencia_motoboy' and entregador_id=$2`, [din.id, mA.id]).catch((e) => ({ n: -1, e: e.message }))
  ok('financeiro ligado: o dinheiro fica pendente no acerto do motoboy (não some do caixa)', pend.n === 1 && pend.v === Math.round(Number(din.total) * 100), JSON.stringify(pend))
  await db.query(`update restaurantes set financeiro_ativo=$2 where id=$1`, [loja.id, loja.financeiro_ativo])
  await dp.goto(`${BASE}/admin/lista-pedidos`, { waitUntil: 'networkidle' }); await fecharAvisos(dp)
  await dp.getByTestId('selo-entregue-automatico').first().waitFor({ timeout: 15000 }).catch(() => {})
  ok('selo "Entregue (automático)" no histórico', (await dp.getByTestId('selo-entregue-automatico').count()) >= 1)
  await dp.screenshot({ path: join(PRINTS, 'E1-selo-historico.png') })
  await ctx.close()
} catch (e) {
  falhas++; console.error('ERRO', e)
} finally {
  await db.query(`update pedidos set status='cancelado' where id = any($1::uuid[]) and status not in ('entregue','cancelado')`, [criados])
  await db.query(`update entregadores set desativado_em=now(), status='offline' where restaurante_id=$1 and nome like 'Teste Moto %'`, [loja.id])
  await db.query(`update restaurantes set status_loja=$2, despacho_aberto=$3, despacho_automatico=$4, latitude=$5, longitude=$6, instagram_url=$7, impressao_qr=$8 where id=$1`,
    [loja.id, loja.status_loja, loja.despacho_aberto, loja.despacho_automatico, loja.latitude, loja.longitude, loja.instagram_url, loja.impressao_qr])
  await browser.close(); await db.end()
  console.log(`\n${total - falhas}/${total} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`)
  process.exit(falhas ? 1 : 0)
}
