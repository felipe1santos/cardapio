/**
 * E2E — correções do Pix online achadas no teste real (2026-10-07). MP SIMULADO, loja local `fin-int`.
 *   b) prazo: o MP recebe no mínimo 31 min (abaixo de 30 ele cancela na hora); o pedido vence pelo
 *      prazo da loja e a verificação periódica cancela no MP;
 *   c) chave Pix: conectar sem chave → aviso amarelo, vitrine sem "Pagar agora", pedido recusado;
 *      cadastrou → "Verificar de novo" libera;
 *   d) aviso "conectada" uma vez só e nenhuma releitura em loop;
 *   e) notificação no formato antigo (sem x-signature e sem type) → 200 sem gravar; com type e sem
 *      assinatura continua 401 e registrada.
 * (a, o horário na tela do QR, está em components/vitrine/tela-pix-online.test.tsx.)
 *
 *   MP_SIMULADO_ARQUIVO=… CRON_SECRET=… node scripts/pix-online/e2e-correcoes.mjs [prints]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const SENHA = 'demo-local-123456'
const ARQ = process.env.MP_SIMULADO_ARQUIVO
const CRON = process.env.CRON_SECRET
const PRINTS = process.argv[2] ?? '.shots/pix-correcoes'
mkdirSync(PRINTS, { recursive: true })
if (!ARQ || !CRON) { console.error('Defina MP_SIMULADO_ARQUIVO e CRON_SECRET (os do servidor).'); process.exit(2) }
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id, pix_online_ativo a, pix_online_validade_min v from restaurantes where slug=$1`, [SLUG])
const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 order by preco limit 1`, [loja.id])
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const sim = () => (existsSync(ARQ) ? JSON.parse(readFileSync(ARQ, 'utf8')) : { contas: {}, codigos: {}, pagamentos: {} })
const gravarSim = (e) => writeFileSync(ARQ, JSON.stringify(e, null, 1))
const falhas = (f) => { const e = sim(); e.falhas = f; gravarSim(e) }
const cron = () => fetch(`${BASE}/api/cron/pix-online`, { method: 'POST', headers: { 'x-cron-secret': CRON } }).then((r) => r.json())
const vitrine = () => fetch(`${BASE}/api/loja/${SLUG}/pix-online`).then((r) => r.json())
const criados = []
async function pedidoPix() {
  const r = await fetch(`${BASE}/api/loja/${SLUG}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', pagamento: 'pix', pixOnline: true, cliente: { nome: 'TESTE pix correcoes', telefone: '11912340993' },
    itens: [{ itemId: item.id, quantidade: 1, complementos: [] }], endereco: {}, chavePedido: randomUUID(),
  }) })
  const j = await r.json().catch(() => null)
  if (j?.id) criados.push(j.id)
  return { status: r.status, j }
}

const browser = await chromium.launch()
async function sessao(login) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { ctx, p }
}
const abrirCardMp = async (p) => {
  await p.getByTestId('integracao-mercadopago').first().click().catch(() => {})
  await p.getByTestId('cartao-mercadopago').waitFor({ timeout: 10000 })
}

try {
  await db.query(`update restaurantes set pix_online_ativo = (id = $1), pix_online_validade_min = 15 where id = $1 or pix_online_ativo`, [loja.id])
  await db.query(`delete from pagamentos_contas where restaurante_id=$1`, [loja.id])
  gravarSim({ contas: {}, codigos: {}, pagamentos: {}, falhas: { semChavePix: true } })

  secao('c) conectar uma conta SEM chave Pix')
  const d = await sessao('dono.finint')
  let leituras = 0
  d.p.on('request', (r) => { if (/\/api\/admin\/(pix-online|whatsapp\/status|integracoes\/meta-capi|nexta\/config)/.test(r.url())) leituras++ })
  await d.p.goto(`${BASE}/api/integracoes/mercadopago/conectar`)
  await d.p.waitForURL((u) => u.search.includes('mercadopago='), { timeout: 20000 }).catch(() => {})
  ok('volta com "conectado_sem_chave"', d.p.url().includes('mercadopago=conectado_sem_chave'), d.p.url())
  const conta = await um(`select status, erro from pagamentos_contas where restaurante_id=$1`, [loja.id])
  ok('conta conectada e marcada sem chave Pix', conta?.status === 'conectada' && conta.erro === 'sem_chave_pix', JSON.stringify(conta))
  ok('vitrine NÃO oferece "Pagar agora"', (await vitrine()).ativo === false)
  const recusado = await pedidoPix()
  ok('pedido com Pix online é recusado no servidor', recusado.status >= 400 && recusado.status < 500, `${recusado.status} ${JSON.stringify(recusado.j)?.slice(0, 120)}`)
  await d.p.waitForTimeout(1500)
  const cartao = d.p.getByTestId('cartao-mercadopago')
  if (!(await cartao.isVisible().catch(() => false))) await abrirCardMp(d.p)
  ok('aviso amarelo "Cadastre uma chave Pix no app do Mercado Pago"', await d.p.getByTestId('mp-sem-chave').isVisible() && /Cadastre uma chave Pix no app do Mercado Pago/.test(await d.p.getByTestId('mp-sem-chave').innerText()))
  const cor = await d.p.getByTestId('mp-sem-chave').evaluate((e) => getComputedStyle(e).backgroundColor)
  ok('aviso em amarelo (fundo claro, texto escuro)', cor === 'rgb(254, 243, 199)', cor)

  secao('d) aviso de conexão uma vez só e sem loop')
  const base = leituras
  await d.p.waitForTimeout(6000)
  const avisos = await d.p.getByTestId('toast').allInnerTexts()
  ok('aviso da volta do MP aparece uma vez', avisos.filter((t) => /Conta conectada|conectada/.test(t)).length <= 1, JSON.stringify(avisos))
  ok('parada 6 s: nenhuma releitura em loop', leituras - base <= 2, `${base} → ${leituras}`)
  await d.p.screenshot({ path: join(PRINTS, 'sem-chave-1366.png') })

  secao('c) cadastrou a chave: "Verificar de novo" libera')
  falhas({})
  await d.p.getByTestId('mp-verificar-chave').click()
  await d.p.getByTestId('mp-sem-chave').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const conta2 = await um(`select erro from pagamentos_contas where restaurante_id=$1`, [loja.id])
  ok('marca de "sem chave" some e o aviso sai', conta2?.erro === null && (await d.p.getByTestId('mp-sem-chave').count()) === 0, JSON.stringify(conta2))
  ok('vitrine volta a oferecer "Pagar agora"', (await vitrine()).ativo === true)
  const sondas = Object.values(sim().pagamentos).filter((x) => String(x.referencia).startsWith('verificacao-chave-pix:'))
  ok('a sondagem não fica aberta no MP (cancelada na hora)', sondas.length >= 1 && sondas.every((x) => x.status === 'cancelled'), JSON.stringify(sondas.map((x) => x.status)))
  await d.ctx.close()

  secao('b) prazo da loja de 5 min: MP recebe 31 min, pedido vence em 5')
  await db.query(`update restaurantes set pix_online_validade_min = 5 where id=$1`, [loja.id])
  const t0 = Date.now()
  const a = await pedidoPix()
  ok('pedido criado com QR (o MP não cancelou na hora)', a.status === 201 && a.j?.pix?.qrCode && a.j?.aguardandoPagamento === true, `${a.status} ${JSON.stringify(a.j)?.slice(0, 160)}`)
  const reg = await um(`select mp_payment_id, status, status_mp, expira_em from pagamentos_online where pedido_id=$1`, [a.j?.id])
  const pgSim = sim().pagamentos[reg?.mp_payment_id]
  const minMp = (Date.parse(pgSim?.expiraEm) - t0) / 60000
  const minLocal = (new Date(reg?.expira_em).getTime() - t0) / 60000
  ok('MP recebeu vencimento de ≥ 30 min', minMp >= 30 && minMp < 33, minMp.toFixed(1))
  ok('cobrança pendente no MP (não "cancelled")', reg?.status_mp === 'pending' && pgSim?.status === 'pending', `${reg?.status_mp}/${pgSim?.status}`)
  ok('pedido vence pelo prazo da loja (5 min)', minLocal > 4.5 && minLocal < 5.5, minLocal.toFixed(2))
  // Venceu aqui (simula 5 min depois): a verificação cancela no MP e expira o pedido.
  await db.query(`update pagamentos_online set expira_em = now() - interval '2 minutes' where pedido_id=$1`, [a.j.id])
  await cron()
  const ped = await um(`select status, cancelado_motivo from pedidos where id=$1`, [a.j.id])
  ok('venceu: pedido cancelado por "pix_expirado"', ped?.status === 'cancelado' && ped.cancelado_motivo === 'pix_expirado', JSON.stringify(ped))
  ok('venceu: cobrança cancelada no MP', sim().pagamentos[reg.mp_payment_id]?.status === 'cancelled')

  secao('e) notificações do MP sem uso')
  const antes = (await um(`select count(*)::int n from pagamentos_eventos`)).n
  const ipn = await fetch(`${BASE}/api/webhooks/mercadopago?topic=payment&id=123456`, { method: 'POST' })
  const ipn2 = await fetch(`${BASE}/api/webhooks/mercadopago?topic=merchant_order&id=987`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"resource":"x","topic":"merchant_order"}' })
  const depois = (await um(`select count(*)::int n from pagamentos_eventos`)).n
  ok('formato antigo (sem assinatura e sem type): 200 e nada gravado', ipn.status === 200 && ipn2.status === 200 && depois === antes, `${ipn.status}/${ipn2.status} ${antes}→${depois}`)
  const falso = await fetch(`${BASE}/api/webhooks/mercadopago?data.id=123&type=payment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: '123' } }) })
  const depois2 = (await um(`select count(*)::int n from pagamentos_eventos`)).n
  ok('com "type" e sem assinatura: 401 e registrado', falso.status === 401 && depois2 === depois + 1, `${falso.status} ${depois}→${depois2}`)
} catch (e) {
  ok('execução sem exceção', false, String(e?.message ?? e).slice(0, 400))
} finally {
  await browser.close()
  if (criados.length) {
    await db.query(`delete from pagamentos_online where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from fin_lancamentos where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedidos where id = any($1)`, [criados]).catch((e) => console.log('   (limpeza)', e.message))
  }
  await db.query(`delete from pagamentos_contas where restaurante_id=$1`, [loja.id])
  await db.query(`update restaurantes set pix_online_ativo=$2, pix_online_validade_min=$3 where id=$1`, [loja.id, loja.a, loja.v])
  gravarSim({ contas: {}, codigos: {}, pagamentos: {} })
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
