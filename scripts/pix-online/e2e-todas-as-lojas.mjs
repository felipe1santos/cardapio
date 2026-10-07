/**
 * E2E — Pix online liberado para todas as lojas (0155, noite 5). Stack LOCAL, MP simulado.
 *   · todas as lojas com a flag (e o padrão de lojas novas ligado);
 *   · loja SEM conta conectada: a vitrine não oferece Pix online (API e tela, nova e clássica) e o
 *     servidor recusa pedido com Pix online — igual a antes;
 *   · o card "Mercado Pago" aparece em Integrações (Disponíveis) para o dono conectar.
 * (Conta conectada sem chave Pix: scripts/pix-online/e2e-correcoes.mjs.)
 *
 *   node scripts/pix-online/e2e-todas-as-lojas.mjs [prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? '.shots/pix-todas'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const NOVA = 'p8-longa'
const CLASSICA = 'ordem-qr-e2e'
const n0 = await um(`select id, vitrine_nova vn from restaurantes where slug=$1`, [NOVA])
const c0 = await um(`select id, vitrine_nova vn from restaurantes where slug=$1`, [CLASSICA])

const browser = await chromium.launch()
try {
  secao('flag em todas as lojas')
  const f = await um(`select count(*) filter (where pix_online_ativo)::int l, count(*)::int t from restaurantes`)
  ok('todas as lojas com o Pix online liberado', f.l === f.t, JSON.stringify(f))
  const d = await um(`select column_default from information_schema.columns where table_schema='public' and table_name='restaurantes' and column_name='pix_online_ativo'`)
  ok('loja nova já nasce liberada (padrão true)', d?.column_default === 'true', JSON.stringify(d))

  secao('loja sem conta conectada: nada muda para o cliente')
  await db.query(`delete from pagamentos_contas where restaurante_id = any($1)`, [[n0.id, c0.id]])
  await db.query(`update restaurantes set vitrine_nova=true where id=$1`, [n0.id])
  await db.query(`update restaurantes set vitrine_nova=false where id=$1`, [c0.id])
  const semConta = (await db.query(`select r.slug from restaurantes r where not exists (select 1 from pagamentos_contas c where c.restaurante_id=r.id) order by r.slug limit 12`)).rows.map((r) => r.slug)
  const apis = await Promise.all(semConta.map((s) => fetch(`${BASE}/api/loja/${s}/pix-online`).then((r) => r.json()).then((j) => ({ s, ativo: j.ativo }))))
  ok(`API da vitrine: Pix online desligado nas ${apis.length} lojas sem conta`, apis.every((a) => a.ativo === false), JSON.stringify(apis.filter((a) => a.ativo)))
  const item = await um(`select id from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 order by preco limit 1`, [c0.id])
  const r = await fetch(`${BASE}/api/loja/${CLASSICA}/pedido`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    tipo: 'retirada', pagamento: 'pix', pixOnline: true, cliente: { nome: 'TESTE pix todas', telefone: '11912340994' },
    itens: [{ itemId: item.id, quantidade: 1, complementos: [] }], endereco: {}, chavePedido: randomUUID(),
  }) })
  ok('servidor recusa pedido com Pix online em loja sem conta', r.status >= 400 && r.status < 500, String(r.status))

  for (const [slug, rotulo] of [[NOVA, 'nova'], [CLASSICA, 'clássica']]) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(1200)
    const html = await p.content()
    ok(`vitrine ${rotulo}: sem "Pagar agora" nem "Pix online" na página`, !/Pagar agora|Pix online/i.test(await p.evaluate(() => document.body.innerText)) && !html.includes('data-testid="pagar-agora"'))
    await p.screenshot({ path: join(PRINTS, `vitrine-${slug}-390.png`) })
    await ctx.close()
  }

  secao('painel: card do Mercado Pago para conectar')
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.finint'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  const lojaDono = await um(`select restaurante_id from usuarios where usuario='dono.finint'`)
  await db.query(`delete from pagamentos_contas where restaurante_id=$1`, [lojaDono.restaurante_id])
  await p.goto(`${BASE}/admin/integracoes`, { waitUntil: 'load' })
  await p.waitForTimeout(2500)
  const card = p.getByTestId('integracao-mercadopago').first()
  ok('Mercado Pago aparece em Integrações (Disponíveis)', await card.isVisible())
  // Janelas de aviso do painel (pendências, novidades) podem estar por cima: clique direto no card.
  await card.evaluate((e) => e.click())
  await p.getByTestId('cartao-mercadopago').waitFor({ timeout: 10000 })
  await p.getByTestId('mp-conectar').waitFor({ timeout: 10000 }).catch(() => {})
  ok('card com "Conectar Mercado Pago" e "Desconectado"', await p.getByTestId('mp-conectar').isVisible() && /desconectado/i.test(await p.getByTestId('mp-situacao').innerText()))
  await p.screenshot({ path: join(PRINTS, 'integracoes-mp-1366.png') })
  await ctx.close()
} catch (e) {
  ok('execução sem exceção', false, String(e?.message ?? e).slice(0, 400))
} finally {
  await browser.close()
  await db.query(`delete from pedidos where cliente_telefone like '%11912340994'`).catch(() => {})
  await db.query(`update restaurantes set vitrine_nova=$2 where id=$1`, [n0.id, n0.vn])
  await db.query(`update restaurantes set vitrine_nova=$2 where id=$1`, [c0.id, c0.vn])
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
