/**
 * Resumo do pedido no DESKTOP (vitrine nova), 2026-10-06 — dois problemas relatados pelo dono:
 *   A. "Peça também" com complemento obrigatório (ex.: açaí) abria a ficha ATRÁS do resumo: não dava para
 *      escolher. Agora a ficha abre por cima, escolhe, adiciona e volta ao resumo com o item. O lápis de
 *      editar um item do resumo também.
 *   B. "Aplicar" cupom no resumo dava erro: a sacola oferecia cupom que o cliente não podia usar (ex.:
 *      "recompra" para quem pede sempre). Agora o cliente logado só vê os que pode usar; aplicar mostra o
 *      desconto sem sair do resumo; sem login, cupom exclusivo abre a janela de entrar.
 * Banco e servidor LOCAIS (cantina-demo, chave vitrine_nova só durante o teste; tudo de teste é apagado).
 *   node scripts/vitrine/e2e-resumo-desktop.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const PRINTS = join(homedir(), 'Downloads', 'revisao-resumo-desktop'); mkdirSync(PRINTS, { recursive: true })
const SLUG = 'cantina-demo', TEL = '5527990005858'
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
const um = async (q, a) => (await db.query(q, a)).rows[0]
let falhas = 0, total = 0
const ok = (m, c, d = '') => { total++; console.log(`${c ? '✓' : '✗'} ${m}${c ? '' : ' — ' + d}`); if (!c) falhas++ }

const loja = await um(`select id, vitrine_nova vn from restaurantes where slug=$1`, [SLUG])
const burger = await um(`select id, nome from itens_cardapio where restaurante_id=$1 and nome='Burger da Casa'`, [loja.id])
const simples = await um(`select i.id, i.nome from itens_cardapio i where i.restaurante_id=$1 and i.status='disponivel' and not exists (select 1 from grupos_item_complementos g where g.item_id=i.id and g.obrigatorio) and not exists (select 1 from tamanhos_item t where t.item_id=i.id) order by i.nome limit 1`, [loja.id])
const limpar = async () => {
  await db.query(`delete from order_bumps where restaurante_id=$1 and item_id=$2 and posicao=957`, [loja.id, burger.id])
  await db.query(`delete from cupons where restaurante_id=$1 and codigo='TESTEVOLTA'`, [loja.id])
  await db.query(`delete from pedidos where restaurante_id=$1 and cliente_telefone=$2`, [loja.id, TEL])
  await db.query(`delete from clientes where restaurante_id=$1 and telefone=$2`, [loja.id, TEL])
}
await limpar()
await db.query(`update restaurantes set vitrine_nova=true where id=$1`, [loja.id])
await db.query(`insert into order_bumps (restaurante_id, item_id, posicao, ativo) values ($1,$2,957,true)`, [loja.id, burger.id])
await db.query(`insert into cupons (restaurante_id, codigo, descricao, ativo, tipo, valor, publico, dias_inatividade) values ($1,'TESTEVOLTA','Teste recompra',true,'desconto_percentual',10,'recompra',30)`, [loja.id])
const cli = await um(`insert into clientes (restaurante_id, telefone, nome) values ($1,$2,'TESTE Resumo') returning token`, [loja.id, TEL])
// Cliente que pede sempre: 2 pedidos entregues recentes → não pode usar o cupom de "recompra".
for (const n of [958001, 958002]) await db.query(`insert into pedidos (restaurante_id, numero, tipo, status, cliente_nome, cliente_telefone, forma_pagamento, subtotal, total) values ($1,$2,'retirada','entregue','TESTE Resumo',$3,'dinheiro',10,10)`, [loja.id, n, TEL])

const browser = await chromium.launch()
async function abrirResumo(logado, irAoResumo = true) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, locale: 'pt-BR' })
  if (logado) await ctx.addInitScript((s) => localStorage.setItem('menuzia_cliente_cantina-demo', s), JSON.stringify({ telefone: TEL, token: cli.token, verificado: true }))
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  for (const t of ['Continuar no cardápio', 'Agora não']) await p.getByText(t).first().click({ timeout: 1200 }).catch(() => {})
  await p.getByText(simples.nome, { exact: true }).first().click(); await p.waitForTimeout(600)
  await p.getByRole('button', { name: /Adicionar/ }).last().click(); await p.waitForTimeout(800)
  // "Continuar" da sacola abre o resumo do pedido (checkout, passo 0) no desktop
  if (!irAoResumo) return { ctx, p }
  const alvo = await p.evaluate(() => {
    const bs = [...document.querySelectorAll('button')].filter((b) => /^Continuar\s*R\$/.test(b.innerText.trim()))
    for (const b of bs) { b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const no = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (r.width && no && b.contains(no)) return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
    return null
  })
  if (alvo) await p.mouse.click(alvo.x, alvo.y)
  await p.waitForTimeout(1200)
  // Se abriu na Entrega, volta uma etapa: no desktop a anterior é o "Resumo do pedido".
  for (let i = 0; i < 2 && !(await p.getByText('Resumo do pedido', { exact: false }).first().isVisible().catch(() => false)); i++) {
    await p.locator('[data-testid="checkout"] button[aria-label="Voltar"]:visible').first().click().catch(() => {})
    await p.waitForTimeout(800)
  }
  return { ctx, p }
}
const fichaPorCima = (p) => p.evaluate(() => {
  const f = document.querySelector('[data-testid="ficha-produto"]'); const r = f.getBoundingClientRect()
  const no = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 200))
  return !!no && f.contains(no)
})

try {
  console.log('\n── A. "Peça também" com complemento obrigatório, no resumo')
  {
    const { ctx, p } = await abrirResumo(true)
    const resumo = p.getByText('Resumo do pedido', { exact: false }).first()
    ok('resumo do pedido aberto', await resumo.isVisible().catch(() => false))
    await p.getByRole('button', { name: `Adicionar ${burger.nome}` }).last().click(); await p.waitForTimeout(800)
    ok('ficha do item abre POR CIMA do resumo', await fichaPorCima(p))
    await p.screenshot({ path: join(PRINTS, 'peca-tambem-ficha-por-cima-1366.png') })
    // escolhe 1 opção em cada grupo obrigatório
    const ficha = p.getByTestId('ficha-produto')
    // Os dois grupos obrigatórios do "Burger da Casa" (banco local): ponto e bebida.
    for (const opcao of ['Ao ponto', 'Coca-Cola lata']) {
      await ficha.getByText(opcao, { exact: true }).first().scrollIntoViewIfNeeded()
      await ficha.getByText(opcao, { exact: true }).first().click(); await p.waitForTimeout(300)
    }
    const add = ficha.getByRole('button', { name: /^Adicionar/ }).last()
    ok('dá para escolher os complementos e o botão Adicionar libera', await add.isEnabled())
    await add.click(); await p.waitForTimeout(900)
    const linhas = await p.locator('[data-barra-checkout], body').first().evaluate(() => document.body.innerText.includes('Burger da Casa'))
    ok('ficha fecha e o resumo continua aberto com o item novo', !(await fichaPorCima(p).catch(() => false)) && await resumo.isVisible() && linhas)
    await p.screenshot({ path: join(PRINTS, 'peca-tambem-adicionado-1366.png') })
    // lápis de editar um item do resumo
    const lapis = p.locator('[data-testid="checkout"] button[aria-label^="Editar"]:visible').first()
    if (await lapis.count()) {
      await lapis.click(); await p.waitForTimeout(700)
      ok('lápis do resumo: ficha abre por cima', await fichaPorCima(p))
      await p.keyboard.press('Escape'); await p.locator('[data-testid="ficha-fundo"]').click({ position: { x: 10, y: 10 } }).catch(() => {}); await p.waitForTimeout(500)
    } else ok('lápis do resumo encontrado', false)

    console.log('\n── B. Cupons no resumo (logado)')
    const cupons = await p.locator('[data-testid="cupons-sacola"]:visible').first().innerText().catch(() => '')
    ok('cupom de "recompra" NÃO aparece para quem pede sempre', !cupons.includes('TESTEVOLTA'), cupons.replace(/\s+/g, ' '))
    ok('cupom para todos aparece', cupons.includes('BALCAO10'), cupons.replace(/\s+/g, ' '))
    await p.locator('[data-testid="cupons-sacola"]:visible [data-testid="cupom-sacola-aplicar"]').first().click(); await p.waitForTimeout(1500)
    const txt = await p.locator('body').innerText()
    ok('aplicar no resumo: aplicado, sem erro, resumo continua aberto', /Aplicado/.test(txt) && await resumo.isVisible() && !/não pode ser usado|Não foi possível/.test(txt))
    await p.screenshot({ path: join(PRINTS, 'cupom-aplicado-resumo-1366.png') })
    await ctx.close()
  }
  console.log('\n── B2. Cupom exclusivo sem login (aba Cupons)')
  {
    // Sem login o resumo pede o telefone antes; o cupom exclusivo aparece na aba Cupons.
    const { ctx, p } = await abrirResumo(false, false)
    await p.locator('header button, header a', { hasText: 'Cupons' }).first().click(); await p.waitForTimeout(1200)
    const card = p.locator('div', { hasText: 'TESTEVOLTA' }).filter({ has: p.getByRole('button', { name: /Resgatar|Aplicar/ }) }).last()
    if (await card.count()) {
      await card.getByRole('button', { name: /Resgatar|Aplicar/ }).first().click(); await p.waitForTimeout(1200)
      ok('sem login: cupom exclusivo abre a janela de entrar (em vez de erro)', await p.getByTestId('janela-conta').isVisible())
      await p.screenshot({ path: join(PRINTS, 'cupom-exclusivo-sem-login-1366.png') })
    } else ok('sem login: cupom exclusivo listado na aba Cupons', false)
    await ctx.close()
  }
} finally {
  await limpar()
  await db.query(`update restaurantes set vitrine_nova=$2 where id=$1`, [loja.id, loja.vn])
  await browser.close(); await db.end()
  console.log(`\n${total - falhas}/${total} verificações passaram`)
  process.exitCode = falhas ? 1 : 0
}
