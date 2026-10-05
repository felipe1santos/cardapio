/**
 * Prints da tela do cliente do Pix online (celular 390 px) — fluxo real da vitrine, MP SIMULADO.
 * Loja local `fin-int` (conta já conectada pelo e2e-pix-online). Liga a flag só durante o script.
 *   MP_SIMULADO_ARQUIVO=… CRON_SECRET=… node scripts/pix-online/prints-cliente.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'fin-int'
const PASTA = 'docs/pix-online/prints'
const ARQ = process.env.MP_SIMULADO_ARQUIVO
mkdirSync(PASTA, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const loja = (await db.query(`select id from restaurantes where slug=$1`, [SLUG])).rows[0]
const item = (await db.query(`select nome from itens_cardapio where restaurante_id=$1 and status='disponivel' and coalesce(preco,0) > 0 order by preco limit 1`, [loja.id])).rows[0]
const criados = []
await db.query(`update restaurantes set pix_online_ativo=true where id=$1`, [loja.id])
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
const p = await ctx.newPage()
const print = (n) => p.screenshot({ path: `${PASTA}/${n}.png` })

async function fazerPedido() {
  await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  await p.locator('button:has-text("R$")', { hasText: item.nome }).first().tap()
  await p.getByRole('button', { name: /Adicionar/ }).last().tap()
  await p.waitForTimeout(600)
  await p.getByText('Ver sacola').first().tap()
  await p.getByRole('button', { name: /Continuar para pagamento/ }).last().tap()
  const tel = p.getByPlaceholder('(00) 00000-0000').first()
  if (await tel.isVisible({ timeout: 2500 }).catch(() => false)) { await tel.fill('27999887766'); await p.getByRole('button', { name: /^Continuar$/i }).first().tap() }
  await p.getByText('Forma de pagamento', { exact: false }).first().waitFor()
  await p.getByText('Pix', { exact: true }).first().tap()
  await p.waitForTimeout(400)
}

try {
  await fazerPedido()
  await print('1-forma-de-pagamento')
  await p.getByRole('button', { name: /Ir para endereço/ }).tap()
  await p.getByPlaceholder('Seu nome').fill('Cliente Pix')
  await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro')
  await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
  await p.getByPlaceholder('123').fill('10')
  await p.getByRole('button', { name: /Revisar pedido/ }).tap()
  await p.getByRole('button', { name: /Fazer pedido/ }).tap()
  await p.getByTestId('tela-pix-online').waitFor({ timeout: 15000 })
  await p.waitForTimeout(800)
  await print('2-pague-com-pix')
  await p.getByTestId('pix-copiar').tap().catch(() => {})
  await p.waitForTimeout(300)
  await print('3-codigo-copiado')
  // paga no "banco" (MP simulado) e a tela muda sozinha
  const ped = (await db.query(`select p.id, po.mp_payment_id from pedidos p join pagamentos_online po on po.pedido_id=p.id where p.restaurante_id=$1 order by p.criado_em desc limit 1`, [loja.id])).rows[0]
  criados.push(ped.id)
  const e = JSON.parse(readFileSync(ARQ, 'utf8')); e.pagamentos[ped.mp_payment_id].status = 'approved'; writeFileSync(ARQ, JSON.stringify(e, null, 1))
  await p.getByTestId('pix-pago').waitFor({ timeout: 20000 })
  await print('4-pagamento-confirmado')
  await p.waitForTimeout(2500)
  await print('5-pedido-feito')

  // Segundo pedido: deixa expirar
  await fazerPedido()
  await p.getByRole('button', { name: /Ir para endereço/ }).tap()
  await p.getByRole('button', { name: /Revisar pedido/ }).tap().catch(() => {})
  await p.getByRole('button', { name: /Fazer pedido/ }).tap()
  await p.getByTestId('tela-pix-online').waitFor({ timeout: 15000 })
  const ped2 = (await db.query(`select p.id, po.id pid from pedidos p join pagamentos_online po on po.pedido_id=p.id where p.restaurante_id=$1 order by p.criado_em desc limit 1`, [loja.id])).rows[0]
  criados.push(ped2.id)
  await db.query(`update pagamentos_online set expira_em = now() - interval '5 minutes' where id=$1`, [ped2.pid])
  await fetch(`${BASE}/api/cron/pix-online`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } })
  await p.getByTestId('pix-expirado').waitFor({ timeout: 20000 })
  await print('6-expirou')
  console.log('prints em', PASTA)
} finally {
  await browser.close()
  await db.query(`update restaurantes set pix_online_ativo=false where id=$1`, [loja.id])
  if (criados.length) {
    await db.query(`delete from pagamentos_online where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedido_itens where pedido_id = any($1)`, [criados]).catch(() => {})
    await db.query(`delete from pedidos where id = any($1)`, [criados]).catch(() => {})
  }
  await db.end()
}
void existsSync
