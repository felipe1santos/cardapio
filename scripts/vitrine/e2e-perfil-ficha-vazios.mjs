/**
 * E2E — vitrine nova (2026-10-07): estados vazios ilustrados também deslogado, perfil do cliente
 * repaginado (sem "Usar estes dados", só "Editar dados"; telefone não editável) e a ficha "Sobre a
 * loja" (logo, status, WhatsApp, Instagram, endereço com mapa, taxa). Só stack LOCAL (p8-longa com
 * vitrine_nova). Cria um cliente de teste e apaga no fim; devolve a loja como estava.
 *
 *   node scripts/vitrine/e2e-perfil-ficha-vazios.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium, devices } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? '.shots/perfil-ficha'
mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (q, a = []) => (await db.query(q, a)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)

const SLUG = 'p8-longa'
const L = await um(`select id, vitrine_nova vn, instagram_url ig, telefone tel from restaurantes where slug=$1`, [SLUG])
await db.query(`update restaurantes set vitrine_nova=true, instagram_url='https://instagram.com/menuzia.app', telefone=coalesce(nullif(telefone,''),'27999990000') where id=$1`, [L.id])
// Sem cupom público e sem campanha: o estado vazio de Cupons aparece.
const cuponsPub = (await db.query(`select id from cupons where restaurante_id=$1 and ativo`, [L.id])).rows.map((r) => r.id)
await db.query(`update cupons set ativo=false where id = any($1)`, [cuponsPub])
const campAtivas = (await db.query(`select id from campanhas_fidelidade where restaurante_id=$1 and ativa`, [L.id])).rows.map((r) => r.id)
await db.query(`update campanhas_fidelidade set ativa=false where id = any($1)`, [campAtivas])
const TEL = '5527999882201'
await db.query(`delete from clientes where restaurante_id=$1 and telefone=$2`, [L.id, TEL])
const TOKEN = 'e2e-perfil-' + Date.now().toString(36)
await db.query(`insert into clientes (restaurante_id, telefone, nome, token, verificado_em, endereco_rua, endereco_numero, endereco_bairro, endereco_cidade) values ($1,$2,'Maria Teste',$3,now(),'Rua das Flores','120','Centro','Vitória')`, [L.id, TEL, TOKEN])

const browser = await chromium.launch()
async function abrir({ largura = 390, sessao = null } = {}) {
  const ctx = largura < 700
    ? await browser.newContext({ ...devices['iPhone 13'], viewport: { width: largura, height: 844 }, locale: 'pt-BR' })
    : await browser.newContext({ viewport: { width: largura, height: 900 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/loja/${SLUG}`, { waitUntil: 'networkidle' })
  await p.evaluate(([s, ses]) => { localStorage.clear(); if (ses) localStorage.setItem(`menuzia_cliente_${s}`, JSON.stringify(ses)) }, [SLUG, sessao])
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(900)
  for (const alvo of [p.getByText('Continuar no cardápio'), p.getByText('Agora não')]) {
    if (await alvo.first().isVisible().catch(() => false)) { await alvo.first().click().catch(() => {}); await p.waitForTimeout(300) }
  }
  return { ctx, p }
}
// Rodapé (celular) ou topo (desktop): o primeiro botão visível com o rótulo.
async function irAba(p, nome) {
  // O botão do Perfil leva a inicial do cliente antes do rótulo ("D Perfil").
  for (const bs of [p.getByRole('button', { name: nome, exact: true }), p.locator('[data-testid="nav-botoes"] button', { hasText: nome })]) {
    const n = await bs.count()
    let clicou = false
    for (let i = 0; i < n; i++) if (await bs.nth(i).isVisible()) { await bs.nth(i).click(); clicou = true; break }
    if (clicou) break
  }
  await p.waitForTimeout(700)
}
const imgCarregada = (loc) => loc.locator('img').first().evaluate((i) => i.complete && i.naturalWidth > 0)
const semRolagemLateral = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

try {
  secao('1. Deslogado: Pedidos e Cupons com ilustração')
  for (const largura of [360, 390, 1366]) {
    const { ctx, p } = await abrir({ largura })
    await irAba(p, 'Pedidos')
    const ped = p.getByTestId('pedidos-deslogado')
    ok(`${largura}px · Pedidos: ilustração, "Entrar com WhatsApp" e "Ver cardápio"`, await ped.isVisible() && await imgCarregada(ped)
      && (await ped.locator('img').getAttribute('src')).includes('pedidos-vazio') && await p.getByTestId('pedidos-deslogado-acao').isVisible() && await p.getByTestId('pedidos-deslogado-secundaria').isVisible())
    await p.screenshot({ path: join(PRINTS, `pedidos-deslogado-${largura}.png`) })
    await irAba(p, 'Cupons')
    const cup = p.getByTestId('cupons-deslogado')
    ok(`${largura}px · Cupons: ilustração e "Entrar" (sem o cartão duplicado)`, await cup.isVisible() && await imgCarregada(cup)
      && (await cup.locator('img').getAttribute('src')).includes('cupons-vazio') && (await p.getByText('Entre pra ver seu progresso').count()) === 0)
    await p.screenshot({ path: join(PRINTS, `cupons-deslogado-${largura}.png`) })
    await p.getByTestId('cupons-deslogado-acao').click()
    ok(`${largura}px · "Entrar" abre a janela do telefone`, await p.getByTestId('janela-conta').getByText('Informe seu telefone').isVisible())
    ok(`${largura}px · sem rolagem lateral`, await semRolagemLateral(p))
    await ctx.close()
  }

  secao('2. Perfil logado')
  {
    const { ctx, p } = await abrir({ sessao: { telefone: TEL, token: TOKEN, verificado: true } })
    await irAba(p, 'Perfil')
    const perfil = p.getByTestId('perfil-cliente')
    ok('abre o perfil com nome, telefone e "Confirmado"', await perfil.isVisible() && /Maria Teste/.test(await perfil.innerText()) && /Confirmado/.test(await perfil.innerText()))
    ok('sem "Usar estes dados"; só "Editar dados" e "Sair da conta"', (await p.getByText('Usar estes dados').count()) === 0 && await p.getByTestId('perfil-editar').isVisible() && await p.getByTestId('perfil-sair').isVisible())
    ok('endereço salvo com bairro e cidade', /Rua das Flores, 120/.test(await p.getByTestId('perfil-endereco').innerText()) && /Centro · Vitória/.test(await p.getByTestId('perfil-endereco').innerText()))
    await p.screenshot({ path: join(PRINTS, 'perfil-390.png') })
    await p.getByTestId('perfil-editar').click()
    await p.waitForTimeout(400)
    ok('editar: telefone fixo (sem campo) e com a explicação', await p.getByTestId('perfil-telefone-fixo').isVisible() && (await p.getByTestId('janela-conta').getByPlaceholder('(00) 00000-0000').count()) === 0)
    await p.screenshot({ path: join(PRINTS, 'perfil-editar-390.png') })
    await p.getByTestId('janela-conta').getByPlaceholder('Seu nome').fill('Maria Editada')
    await p.getByTestId('janela-conta').getByRole('button', { name: /Salvar/i }).first().click()
    await p.waitForTimeout(1200)
    const c = await um(`select nome from clientes where restaurante_id=$1 and telefone=$2`, [L.id, TEL])
    ok('salvar troca o nome e volta ao perfil', c?.nome === 'Maria Editada' && await p.getByTestId('perfil-salvo').isVisible() && /Maria Editada/.test(await p.getByTestId('perfil-cabecalho').innerText()), JSON.stringify(c))
    await ctx.close()
  }

  secao('3. Ficha "Sobre a loja"')
  for (const largura of [360, 390, 1366]) {
    const { ctx, p } = await abrir({ largura })
    await p.getByRole('button', { name: 'Informações da loja' }).first().click()
    await p.waitForTimeout(600)
    const f = p.getByTestId('ficha-loja')
    ok(`${largura}px · logo, nome e status`, await f.isVisible() && await p.getByTestId('ficha-loja-logo').isVisible() && /Aberta agora|Fechada/.test(await p.getByTestId('ficha-loja-status').innerText()))
    const wa = p.getByTestId('ficha-loja-whatsapp')
    ok(`${largura}px · WhatsApp com ícone e link wa.me`, await wa.isVisible() && /^https:\/\/wa\.me\/55\d{10,11}$/.test((await wa.getAttribute('href')) ?? '') && (await wa.locator('img[src*="whatsapp"]').count()) === 1)
    const ig = p.getByTestId('ficha-loja-instagram')
    ok(`${largura}px · Instagram com @ e link`, await ig.isVisible() && /@menuzia\.app/.test(await ig.innerText()) && (await ig.getAttribute('href')) === 'https://instagram.com/menuzia.app')
    const end = p.getByTestId('ficha-loja-endereco')
    ok(`${largura}px · endereço com mapa`, (await end.count()) === 0 || /google\.com\/maps/.test((await end.getAttribute('href')) ?? ''))
    ok(`${largura}px · cabe na tela sem rolagem lateral`, await semRolagemLateral(p) && await f.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1 }))
    await p.screenshot({ path: join(PRINTS, `ficha-loja-${largura}.png`) })
    await p.getByTestId('ficha-loja-calcular').click()
    await p.waitForTimeout(400)
    ok(`${largura}px · "Calcular a taxa" fecha a ficha`, (await f.count()) === 0)
    await ctx.close()
  }

  secao('4. Sem Instagram: a linha não aparece')
  {
    await db.query(`update restaurantes set instagram_url=null where id=$1`, [L.id])
    const { ctx, p } = await abrir({ largura: 390 })
    await p.getByRole('button', { name: 'Informações da loja' }).first().click()
    await p.waitForTimeout(500)
    ok('sem Instagram cadastrado, sem a linha', (await p.getByTestId('ficha-loja-instagram').count()) === 0 && await p.getByTestId('ficha-loja').isVisible())
    await ctx.close()
  }
} catch (e) {
  ok('execução sem exceção', false, String(e?.message ?? e).slice(0, 400))
} finally {
  await browser.close()
  await db.query(`delete from clientes where restaurante_id=$1 and telefone=$2`, [L.id, TEL])
  await db.query(`update cupons set ativo=true where id = any($1)`, [cuponsPub])
  await db.query(`update campanhas_fidelidade set ativa=true where id = any($1)`, [campAtivas])
  await db.query(`update restaurantes set vitrine_nova=$2, instagram_url=$3, telefone=$4 where id=$1`, [L.id, L.vn, L.ig, L.tel])
  await db.end()
}
const passou = res.filter(Boolean).length
console.log(`\n${passou === res.length ? '✅' : '❌'} ${passou}/${res.length} verificações passaram — prints em ${PRINTS}`)
process.exit(passou === res.length ? 0 : 1)
