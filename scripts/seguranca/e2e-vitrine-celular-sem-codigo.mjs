/**
 * E2E — vitrine no CELULAR (390×844, toque) com o WhatsApp da loja fora: o cliente novo
 * informa o telefone, não recebe código (fallback) e precisa conseguir fechar o pedido.
 *
 * Bug de 2026-09-30: depois do fallback a janela "Informe seu telefone" continuava na tela
 * e o "Continuar para pagamento" pedia o telefone de novo — o cliente não saía dali.
 *
 * Loja local sem instância de WhatsApp (ORDEM_QR_E2E: ordem-qr-e2e). NÃO finaliza o pedido:
 * vai até a revisão. Servidor local em 127.0.0.1:3999.
 *
 *   node scripts/seguranca/e2e-vitrine-celular-sem-codigo.mjs [pasta-de-prints]
 */
import { chromium, devices } from 'playwright'
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = process.env.LOJA ?? 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const semInstancia = (await db.query(`select evolution_instance is null ok from restaurantes where slug=$1`, [SLUG])).rows[0]?.ok
await db.end()
if (!semInstancia) { console.error(`A loja ${SLUG} precisa existir e estar SEM WhatsApp (para cair no fallback).`); process.exit(2) }

const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'pt-BR' })
const p = await ctx.newPage()
const print = async (nome) => { if (PRINTS) await p.screenshot({ path: `${PRINTS}/${nome}.png` }) }

try {
  await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  await p.evaluate(() => localStorage.clear())
  await p.reload({ waitUntil: 'networkidle' })

  // Item simples (sem opções obrigatórias).
  await p.locator('button:has-text("R$")', { hasText: process.env.ITEM ?? 'Coca Lata' }).first().tap()
  const add = p.getByRole('button', { name: /Adicionar/ }).last()
  await add.waitFor({ timeout: 5000 })
  await add.tap()
  await p.waitForTimeout(600)
  const adicionou = await p.getByText('Ver sacola').first().isVisible().catch(() => false)
  ok('item na sacola', adicionou)
  await p.getByText('Ver sacola').first().tap()
  await p.getByRole('button', { name: /Continuar para pagamento/ }).last().tap()
  const tel = p.getByPlaceholder('(00) 00000-0000').first()
  await tel.waitFor({ timeout: 5000 })
  ok('sem conta: pede o telefone', await tel.isVisible())
  await print('1-telefone')
  await tel.fill('27999887766')
  await p.getByRole('button', { name: /^Continuar$/i }).first().tap()
  await p.waitForTimeout(1500)
  await print('2-depois-do-telefone')
  ok('a janela do telefone fecha (não fica presa em "Informe seu telefone")', !(await p.getByText('Informe seu telefone').isVisible().catch(() => false)))
  ok('segue sozinho para a forma de pagamento', await p.getByText('Forma de pagamento', { exact: false }).first().isVisible().catch(() => false))

  await p.getByText('Dinheiro', { exact: true }).first().tap()
  const troco = p.getByPlaceholder(/Ex: 50,00/).first()
  ok('dinheiro pede troco', await troco.isVisible().catch(() => false))
  await troco.fill('100')
  await p.getByRole('button', { name: /Ir para endereço/ }).tap()
  await p.waitForTimeout(600)
  const telCheckout = await p.getByPlaceholder('(00) 00000-0000').first().inputValue().catch(() => '')
  ok('telefone informado já vem preenchido no checkout', telCheckout.replace(/\D/g, '').endsWith('27999887766'), telCheckout)
  await p.getByPlaceholder('Seu nome').fill('Cliente Celular')
  const bairro = p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first()
  await bairro.fill('Centro')
  await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
  await p.getByPlaceholder('123').fill('10')
  await p.waitForTimeout(1500)
  await print('3-endereco')

  // Barra do botão presa ao fundo ao rolar e quando a barra de endereço do navegador
  // some/aparece (a altura da tela muda no meio da rolagem). Antes (fixed dentro de camada
  // com transform) o botão subia, abria vão branco embaixo e cobria os campos.
  const botao = p.getByRole('button', { name: /Revisar pedido/ })
  const conferirFundo = async (rotulo) => {
    const alt = p.viewportSize().height
    const caixa = await botao.boundingBox()
    const barra = await botao.evaluate((b) => b.parentElement.getBoundingClientRect().bottom)
    return { rotulo, alt, barraFundo: Math.round(barra), botaoTopo: Math.round(caixa?.y ?? -1) }
  }
  const medidas = []
  for (const [altura, delta] of [[844, 400], [844, -300], [760, 500], [760, -800], [844, 900]]) {
    await p.setViewportSize({ width: 390, height: altura })
    await p.mouse.wheel(0, delta)
    await p.waitForTimeout(250)
    medidas.push(await conferirFundo(`${altura}px rolando ${delta}`))
  }
  ok('botão fica colado no fundo da tela ao rolar e com a barra do navegador mudando', medidas.every((m) => Math.abs(m.barraFundo - m.alt) <= 2), JSON.stringify(medidas.filter((m) => Math.abs(m.barraFundo - m.alt) > 2)))
  // Rolado até o fim, o último campo aparece inteiro acima da barra (não fica embaixo dela).
  await p.mouse.wheel(0, 3000)
  await p.waitForTimeout(300)
  const ref = p.getByPlaceholder(/ao lado da padaria/).first()
  const cRef = await ref.boundingBox()
  const topoBarra = await botao.evaluate((b) => b.parentElement.getBoundingClientRect().top)
  ok('último campo não fica escondido atrás do botão', !!cRef && cRef.y + cRef.height <= topoBarra + 1, `campo termina em ${Math.round((cRef?.y ?? 0) + (cRef?.height ?? 0))}, barra começa em ${Math.round(topoBarra)}`)
  await print('3b-endereco-rolado')
  await p.getByRole('button', { name: /Revisar pedido/ }).tap()
  await p.waitForTimeout(1000)
  await print('4-revisao')
  const naRevisao = await p.getByRole('button', { name: /Fazer pedido/ }).isVisible().catch(() => false)
  const erro = await p.locator('.text-danger').first().innerText().catch(() => '')
  ok('chega na revisão com "Fazer pedido" (pagamento e entrega escolhidos no celular)', naRevisao, naRevisao ? '' : erro)

  await p.reload({ waitUntil: 'networkidle' })
  await p.getByText('Ver sacola').first().tap()
  await p.getByRole('button', { name: /Continuar para pagamento/ }).last().tap()
  await p.waitForTimeout(800)
  ok('depois de recarregar vai direto ao pagamento (não pede o telefone de novo)', !(await p.getByText('Informe seu telefone').isVisible().catch(() => false)) && await p.getByText('Forma de pagamento', { exact: false }).first().isVisible().catch(() => false))
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await browser.close()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
