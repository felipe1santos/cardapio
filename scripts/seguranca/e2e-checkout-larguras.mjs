/**
 * E2E — checkout da vitrine no celular em 360, 390 e 414 px (Fase 1.2, 2026-09-30).
 * Desde a pendência 9 (2026-10-06) o fluxo é o do iFood: sacola → Entrega (endereço/dados e
 * opção de entrega ou retirada) → Pagamento → painel "Revise o seu pedido" → Fazer pedido.
 * Para cada largura × entrega/retirada × forma de pagamento: faz o pedido de ponta a ponta
 * e confere em CADA etapa (entrega, pagamento, revisão) que:
 *   · a barra do botão fica colada no fundo e por cima de nada que o cliente precise;
 *   · nenhuma barra de navegação/menu fica por cima do checkout;
 *   · a tela rola até o último campo, que fica acima da barra;
 *   · o botão principal está visível e é ele que recebe o toque.
 * O pedido tem que chegar ao banco (o painel lê de lá). Apaga os pedidos no fim.
 * Loja local sem WhatsApp (ordem-qr-e2e) — o telefone entra pelo fallback.
 *
 *   node scripts/seguranca/e2e-checkout-larguras.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SLUG = 'ordem-qr-e2e'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id, aceita_entrega, aceita_retirada from restaurantes where slug=$1`, [SLUG])).rows[0]
await db.query(`update restaurantes set aceita_entrega=true, aceita_retirada=true where id=$1`, [loja.id])
const TEL = '27999880022'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

/** Barra do botão no fundo, nada por cima, botão recebe o toque. */
async function conferirEtapa(p, botaoNome, rotulo, ultimoCampo) {
  // Só a barra do checkout aberto (o fechado continua no DOM, fora da tela).
  const botao = p.locator('[data-barra-checkout] button').filter({ hasText: botaoNome }).first()
  await botao.waitFor({ timeout: 8000 })
  const r = await botao.evaluate((b) => {
    // A barra é o bloco marcado com data-barra-checkout (o botão fica dentro de um flex).
    const barra = (b.closest('[data-barra-checkout]') ?? b.parentElement).getBoundingClientRect()
    const cx = b.getBoundingClientRect()
    const alvo = document.elementFromPoint(cx.left + cx.width / 2, cx.top + cx.height / 2)
    return { barraFundo: barra.bottom, alt: window.innerHeight, recebeToque: b === alvo || b.contains(alvo), visivel: cx.top >= 0 && cx.bottom <= window.innerHeight }
  })
  // Rola até o fim do checkout: o último campo tem que terminar acima da barra.
  await p.mouse.wheel(0, 4000)
  await p.waitForTimeout(250)
  let campoOk = true
  if (ultimoCampo) {
    const c = await ultimoCampo.boundingBox()
    const topoBarra = await botao.evaluate((b) => (b.closest('[data-barra-checkout]') ?? b.parentElement).getBoundingClientRect().top)
    campoOk = !!c && c.y + c.height <= topoBarra + 1
  }
  const passou = Math.abs(r.barraFundo - r.alt) <= 2 && r.recebeToque && r.visivel && campoOk
  ok(`${rotulo}: barra no fundo, botão visível e tocável${ultimoCampo ? ', rola até o último campo' : ''}`, passou, passou ? '' : JSON.stringify({ ...r, campoOk }))
}

const browser = await chromium.launch()
const criados = []
try {
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  for (const largura of [360, 390, 414]) {
    for (const tipo of ['entrega', 'retirada']) {
      for (const pag of ['Pix', 'Cartão', 'Dinheiro']) {
        const rot = `${largura}px ${tipo} ${pag}`
        console.log(`\n── ${rot} ──`)
        const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: largura, height: 780 }, locale: 'pt-BR' })
        const p = await ctx.newPage()
        try {
          await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
          await p.evaluate(() => localStorage.clear())
          await p.reload({ waitUntil: 'networkidle' })
          await p.locator('button:has-text("R$")', { hasText: 'Coca Lata' }).first().tap()
          await p.getByRole('button', { name: /Adicionar/ }).last().tap()
          await p.waitForTimeout(500)
          await p.getByText('Ver sacola').first().tap()
          await p.locator('[data-testid="barra-sacola-continuar"] button').tap()
          const tel = p.getByPlaceholder('(00) 00000-0000').first()
          await tel.waitFor({ timeout: 8000 })
          await tel.fill(TEL)
          await p.locator('[data-testid="janela-conta"] button').filter({ hasText: /^Continuar$/i }).tap()
          await p.waitForTimeout(1200)
          // Etapa Entrega: opção de entrega/retirada, dados e endereço.
          await p.getByTestId(tipo === 'entrega' ? 'opcao-entrega-padrao' : 'opcao-retirada').tap()
          await p.getByPlaceholder('Seu nome').fill('Cliente Largura')
          if (tipo === 'entrega') {
            await p.getByPlaceholder(/Digite ou toque na seta|^Bairro/).first().fill('Centro')
            await p.getByPlaceholder('Nome da rua').fill('Rua Teste')
            await p.getByPlaceholder('123').fill('10')
            await p.waitForTimeout(1000)
          }
          await conferirEtapa(p, /^Continuar$/, `${rot} · ${tipo === 'entrega' ? 'endereço' : 'dados'}`, p.locator('[data-testid="etapa-entrega"] input').last())
          if (PRINTS) await p.screenshot({ path: join(PRINTS, `${largura}-${tipo}-${pag}-1-entrega.png`) })
          await p.locator('[data-barra-checkout] button').filter({ hasText: /^Continuar$/ }).first().tap()
          await p.waitForTimeout(600)
          // Etapa Pagamento.
          await p.getByTestId({ Pix: 'pagamento-pix', Cartão: 'pagamento-cartao', Dinheiro: 'pagamento-dinheiro' }[pag]).tap()
          if (pag === 'Dinheiro') await p.getByPlaceholder(/Ex: 50,00/).first().fill('100')
          await conferirEtapa(p, /Revisar pedido/, `${rot} · pagamento`)
          if (PRINTS) await p.screenshot({ path: join(PRINTS, `${largura}-${tipo}-${pag}-2-pagamento.png`) })
          await p.locator('[data-barra-checkout] button').filter({ hasText: /Revisar pedido/ }).first().tap()
          await p.waitForTimeout(800)
          // Painel "Revise o seu pedido".
          await conferirEtapa(p, /Fazer pedido/, `${rot} · revisão`)
          if (PRINTS) await p.screenshot({ path: join(PRINTS, `${largura}-${tipo}-${pag}-3-revisao.png`) })
          await p.getByTestId('fazer-pedido').tap()
          await p.waitForTimeout(2500)
          const pedido = (await db.query(`select id, tipo, forma_pagamento, troco_para from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2 order by criado_em desc limit 1`, [loja.id, TEL])).rows[0]
          if (pedido) criados.push(pedido.id)
          const formaEsperada = { Pix: 'pix', Cartão: 'cartao', Dinheiro: 'dinheiro' }[pag]
          ok(`${rot} · pedido chegou ao painel (${tipo}, ${formaEsperada}${pag === 'Dinheiro' ? ', troco 100' : ''})`,
            pedido && pedido.tipo === tipo && pedido.forma_pagamento === formaEsperada && (pag !== 'Dinheiro' || Number(pedido.troco_para) === 100),
            JSON.stringify(pedido ?? null))
          await db.query(`delete from pedidos where id = any($1)`, [criados.splice(0)])
        } catch (e) {
          ok(`${rot} · fluxo completo`, false, String(e).slice(0, 200))
          if (PRINTS) await p.screenshot({ path: join(PRINTS, `${largura}-${tipo}-${pag}-ERRO.png`) }).catch(() => {})
        } finally {
          await ctx.close()
        }
      }
    }
  }
} finally {
  if (criados.length) await db.query(`delete from pedidos where id = any($1)`, [criados])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone like '%'||$2`, [loja.id, TEL])
  await db.query(`update restaurantes set aceita_entrega=$2, aceita_retirada=$3 where id=$1`, [loja.id, loja.aceita_entrega, loja.aceita_retirada])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
