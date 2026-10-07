/**
 * E2E — checkout sem o bloco "Seus dados" (2026-10-07). Só stack LOCAL.
 * Para chegar à etapa de entrega o cliente já entrou pelo telefone, então nome e telefone não
 * são mais pedidos de novo. Confere nas duas vitrines (nova: p8-longa com vitrine_nova; clássica:
 * ordem-qr-e2e):
 *   A. logado com nome no perfil: sem "Seus dados", sem campo de nome/telefone; o pedido chega
 *      ao banco com o nome e o telefone do perfil;
 *   B. logado sem nome no perfil: só o campo "Nome" (sem telefone);
 *   C. sem o código confirmado (fallback, loja sem WhatsApp): só o campo "Nome".
 * Cria clientes/pedidos de teste e apaga tudo no fim; devolve a chave vitrine_nova.
 *
 *   node scripts/vitrine/e2e-checkout-sem-seus-dados.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (q, a = []) => (await db.query(q, a)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)

const NOVA = await um(`select id, slug, vitrine_nova vn, aceita_entrega e from restaurantes where slug='p8-longa'`)
const CLAS = await um(`select id, slug, vitrine_nova vn, aceita_entrega e from restaurantes where slug='ordem-qr-e2e'`)
await db.query(`update restaurantes set vitrine_nova=true, aceita_entrega=true where id=$1`, [NOVA.id])
await db.query(`update restaurantes set vitrine_nova=false, aceita_entrega=true where id=$1`, [CLAS.id])
const TEL_NOME = '5527999881101'
const TEL_SEM = '5527999881102'
const TEL_FB = '27999881103'
const lojas = [NOVA.id, CLAS.id]
const limpar = async () => {
  await db.query(`delete from pedidos where restaurante_id = any($1) and (cliente_telefone like '%881101' or cliente_telefone like '%881102' or cliente_telefone like '%881103')`, [lojas])
  await db.query(`delete from clientes where restaurante_id = any($1) and telefone in ($2,$3)`, [lojas, TEL_NOME, TEL_SEM])
}
await limpar()
const token = () => 'e2e-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
async function criarCliente(lojaId, tel, nome) {
  const t = token()
  await db.query(`insert into clientes (restaurante_id, telefone, nome, token, verificado_em) values ($1,$2,$3,$4,now())`, [lojaId, tel, nome, t])
  return t
}

const browser = await chromium.launch()
async function abrir(slug, sessao) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${slug}`, { waitUntil: 'networkidle' })
  await p.evaluate(([s, ses]) => { localStorage.clear(); if (ses) { localStorage.setItem(`menuzia_cliente_${s}`, JSON.stringify(ses)); localStorage.setItem(`menuzia_telefone_${s}`, ses.telefone) } }, [slug, sessao])
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  for (const alvo of [p.getByText('Continuar no cardápio'), p.getByText('Agora não')]) {
    if (await alvo.first().isVisible().catch(() => false)) { await alvo.first().click().catch(() => {}); await p.waitForTimeout(300) }
  }
  return { ctx, p }
}
const semSeusDados = async (p) => (await p.getByText('Seus dados', { exact: true }).count()) === 0
const campoNome = (p) => p.getByPlaceholder('Seu nome')
const campoTelCheckout = (p) => p.locator('[data-testid="checkout"], [data-checkout]').getByPlaceholder('(00) 00000-0000')

// ── Vitrine nova: sacola → Entrega (etapa 2)
async function novaAteEntrega(p) {
  const item = await um(`select id from itens_cardapio i where restaurante_id=$1 and status='disponivel' and not exists (select 1 from item_grupos_complemento g where g.item_id=i.id) order by nome limit 1`, [NOVA.id]).catch(() => null)
    ?? await um(`select id from itens_cardapio where restaurante_id=$1 and promocao_preco is not null and status='disponivel' limit 1`, [NOVA.id])
  await p.locator(`button[data-item-id="${item.id}"]`).last().tap()
  await p.waitForTimeout(600)
  await p.getByRole('button', { name: /Adicionar/ }).last().tap()
  await p.waitForTimeout(600)
  await p.getByText('Ver sacola').first().tap()
  await p.waitForTimeout(800)
  await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
  await p.waitForTimeout(1000)
}
const barraNova = (p, re) => p.locator('[data-barra-checkout] button').filter({ hasText: re }).first()
async function preencherEndereco(p) {
  await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro')
  await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
  await p.getByPlaceholder('123').fill('10')
  await p.waitForTimeout(1200)
}

// ── Vitrine clássica: sacola → Pagamento → Endereço (etapa 2)
async function classicaAteEndereco(p) {
  await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
  await p.getByRole('button', { name: /Adicionar/ }).last().tap()
  await p.waitForTimeout(500)
  await p.getByText('Ver sacola').first().tap()
  await p.getByRole('button', { name: /^Entrega/ }).first().tap().catch(() => {})
  await p.getByRole('button', { name: /Continuar para pagamento/ }).last().tap()
  await p.waitForTimeout(800)
}
async function classicaPagarEIr(p) {
  await p.getByText('Pix', { exact: true }).first().tap()
  await p.getByRole('button', { name: /Ir para endereço|Continuar/ }).last().tap()
  await p.waitForTimeout(700)
}
async function entrarFallback(p) {
  const tel = p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByPlaceholder('(00) 00000-0000')
  await tel.waitFor({ timeout: 8000 })
  await tel.fill(TEL_FB)
  await p.locator('div').filter({ has: p.getByText('Informe seu telefone') }).last().getByRole('button', { name: /^Continuar$/i }).tap()
  await p.waitForTimeout(1300)
}

try {
  secao('A. Vitrine nova — logado com nome')
  {
    const t = await criarCliente(NOVA.id, TEL_NOME, 'Cliente Com Nome')
    const { ctx, p } = await abrir(NOVA.slug, { telefone: TEL_NOME, token: t, verificado: true })
    await novaAteEntrega(p)
    ok('abre a Entrega', (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'entrega')
    ok('sem "Seus dados", sem campo de nome e de telefone', await semSeusDados(p) && (await campoNome(p).count()) === 0 && (await campoTelCheckout(p).count()) === 0)
    await preencherEndereco(p)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, 'nova-logado-entrega-390.png'), fullPage: true })
    await barraNova(p, /^Continuar$/).tap()
    await p.waitForTimeout(800)
    ok('segue para o Pagamento (nome do perfil vale)', (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'pagamento')
    await p.getByTestId('pagamento-cartao').tap()
    await barraNova(p, /Revisar pedido/).tap()
    await p.waitForTimeout(800)
    ok('revisão mostra o nome do perfil', /Cliente Com Nome/.test(await p.getByTestId('revise-dados').textContent()))
    await p.getByTestId('fazer-pedido').tap()
    await p.waitForTimeout(2500)
    const ped = await um(`select cliente_nome, cliente_telefone from pedidos where restaurante_id=$1 and cliente_telefone like '%881101' order by criado_em desc limit 1`, [NOVA.id])
    ok('pedido no banco com nome e telefone do perfil', ped?.cliente_nome === 'Cliente Com Nome' && /881101$/.test(ped?.cliente_telefone ?? ''), JSON.stringify(ped))
    await ctx.close()
  }

  secao('B. Vitrine nova — logado sem nome')
  {
    const t = await criarCliente(NOVA.id, TEL_SEM, '')
    const { ctx, p } = await abrir(NOVA.slug, { telefone: TEL_SEM, token: t, verificado: true })
    await novaAteEntrega(p)
    await p.getByText('Continuar no cardápio').first().click({ timeout: 800 }).catch(() => {})
    ok('sem "Seus dados"; só o campo Nome, sem telefone', await semSeusDados(p) && (await campoNome(p).count()) === 1 && (await campoTelCheckout(p).count()) === 0)
    await preencherEndereco(p)
    await barraNova(p, /^Continuar$/).tap()
    await p.waitForTimeout(600)
    ok('sem nome não avança', (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'entrega')
    await campoNome(p).fill('Fulano')
    ok('campo não some enquanto digita', (await campoNome(p).count()) === 1)
    await barraNova(p, /^Continuar$/).tap()
    await p.waitForTimeout(800)
    ok('com o nome, avança para o Pagamento', (await p.getByTestId('titulo-etapa').textContent()).trim().toLowerCase() === 'pagamento')
    await ctx.close()
  }

  secao('C. Vitrine nova — sem o código (fallback)')
  {
    const { ctx, p } = await abrir(NOVA.slug, null)
    await novaAteEntrega(p)
    await entrarFallback(p)
    await p.getByText('Continuar no cardápio').first().click({ timeout: 800 }).catch(() => {})
    ok('só o campo Nome, sem "Seus dados" e sem telefone', await semSeusDados(p) && (await campoNome(p).count()) === 1 && (await campoTelCheckout(p).count()) === 0)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, 'nova-fallback-entrega-390.png'), fullPage: true })
    await ctx.close()
  }

  secao('A. Vitrine clássica — logado com nome')
  {
    const t = await criarCliente(CLAS.id, TEL_NOME, 'Cliente Com Nome')
    const { ctx, p } = await abrir(CLAS.slug, { telefone: TEL_NOME, token: t, verificado: true })
    await classicaAteEndereco(p)
    await classicaPagarEIr(p)
    ok('Endereço sem "Seus dados", sem nome e telefone', await semSeusDados(p) && (await campoNome(p).count()) === 0 && (await p.getByPlaceholder('(00) 00000-0000').count()) === 0)
    await preencherEndereco(p)
    if (PRINTS) await p.screenshot({ path: join(PRINTS, 'classica-logado-endereco-390.png'), fullPage: true })
    await p.getByRole('button', { name: /Revisar pedido/ }).tap()
    await p.waitForTimeout(800)
    await p.getByRole('button', { name: /Fazer pedido/ }).tap()
    await p.waitForTimeout(2500)
    const ped = await um(`select cliente_nome, cliente_telefone from pedidos where restaurante_id=$1 and cliente_telefone like '%881101' order by criado_em desc limit 1`, [CLAS.id])
    ok('pedido no banco com nome e telefone do perfil', ped?.cliente_nome === 'Cliente Com Nome' && /881101$/.test(ped?.cliente_telefone ?? ''), JSON.stringify(ped))
    await ctx.close()
  }

  secao('C. Vitrine clássica — sem o código (fallback)')
  {
    const { ctx, p } = await abrir(CLAS.slug, null)
    await classicaAteEndereco(p)
    await entrarFallback(p)
    await classicaPagarEIr(p)
    ok('só o campo Nome, sem "Seus dados"', await semSeusDados(p) && (await campoNome(p).count()) === 1)
    await ctx.close()
  }
} catch (e) {
  ok('execução sem exceção', false, String(e?.message ?? e).slice(0, 400))
} finally {
  await browser.close()
  await limpar()
  await db.query(`update restaurantes set vitrine_nova=$2, aceita_entrega=$3 where id=$1`, [NOVA.id, NOVA.vn, NOVA.e])
  await db.query(`update restaurantes set vitrine_nova=$2, aceita_entrega=$3 where id=$1`, [CLAS.id, CLAS.vn, CLAS.e])
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram`)
process.exit(passou === res.length ? 0 : 1)
