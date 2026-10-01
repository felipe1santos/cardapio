/**
 * E2E — menu lateral (Fase 2, 2026-09-30). Stack local, dono da cantina-pdv2.
 *   · sem a faixa "menuzia"; card da loja com sino e alerta antes da seta;
 *   · sino: estado real (ativas com ponto verde / bloqueadas cortado) e explicação no clique;
 *   · alerta: badge = nº de pendências; modal com "Resolver" levando à tela certa;
 *   · resolver uma pendência diminui o número;
 *   · itens do menu sem marcador de pendência; "Ver meu cardápio" + copiar link;
 *   · celular (390): gaveta com o card, sino e alerta acessíveis.
 * Restaura o telefone da loja no fim.
 *
 *   node scripts/seguranca/e2e-menu-lateral.mjs [pasta-de-prints]
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const PRINTS = process.argv[2] ?? null
if (PRINTS) mkdirSync(PRINTS, { recursive: true })
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const loja = (await db.query(`select id, telefone from restaurantes where slug='cantina-pdv2'`)).rows[0]
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()

async function entrar(ctx) {
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.pdv2@local.test')
  await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }), p.click('button[type="submit"]')])
  return p
}
const fecharModal = async (p) => { await p.getByRole('button', { name: /ok, entendi|^OK$/i }).first().click({ timeout: 3000 }).catch(() => {}) }

try {
  // Uma pendência garantida: loja sem telefone.
  await db.query(`update restaurantes set telefone='' where id=$1`, [loja.id])

  console.log('\n── desktop 1366 ──')
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR', permissions: ['notifications', 'clipboard-read', 'clipboard-write'] })
  // Headless não expõe a permissão concedida: força 'granted' (o bloqueado é testado abaixo).
  await ctx.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'granted' }) })
  const p = await entrar(ctx)
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  await fecharModal(p)
  const aside = p.locator('aside')
  ok('sem a faixa da marca "menuzia" no topo do menu', (await aside.getByText('menuzia', { exact: true }).count()) === 0)
  const card = p.getByTestId('menu-card-loja')
  ok('card da loja no topo com sino e alerta', await card.isVisible() && await card.getByTestId('menu-sino').isVisible() && await card.getByTestId('menu-alerta').isVisible())
  ok('sino reflete a permissão concedida (ativas, ponto verde)', (await p.getByTestId('menu-sino').getAttribute('data-estado')) === 'ativas', await p.getByTestId('menu-sino').getAttribute('data-estado'))
  await p.getByTestId('menu-sino').click()
  ok('clique no sino explica (só com o painel aberto)', /Só com o painel aberto/.test(await card.innerText()))
  await p.getByTestId('menu-sino').click()
  const badge = Number((await p.getByTestId('menu-alerta-badge').innerText()).replace(/\D/g, ''))
  ok('alerta com badge vermelho de pendências', badge >= 1, `${badge}`)
  ok('blocos do rodapé "Notificações ativadas" e "X pendências" sumiram', (await aside.getByText(/^Notificações ativadas$/).count()) === 0 && (await aside.getByRole('button', { name: /^\d+ pend[eê]ncias?$/ }).count()) === 0)
  ok('itens do menu sem marcador de pendência', (await aside.locator('nav [aria-label*="pendência"]').count()) === 0)
  ok('"Ver meu cardápio" e "Sair" continuam', await aside.getByText('Ver meu cardápio').isVisible() && await aside.getByRole('button', { name: 'Sair' }).isVisible())
  await aside.getByRole('button', { name: 'Copiar o link do cardápio' }).click()
  const copiado = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '')
  ok('copiar link do cardápio continua acessível', /\/loja\/cantina-pdv2$/.test(copiado), copiado)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'menu-desktop.png') })

  await p.getByTestId('menu-alerta').click()
  const modal = p.getByRole('dialog')
  await modal.waitFor()
  const resolver = modal.getByTestId('pendencia-resolver')
  const n = await resolver.count()
  ok('modal lista cada pendência com "Resolver" (badge = itens do modal)', n === badge && /Telefone|telefone/.test(await modal.innerText()), `${n} itens`)
  if (PRINTS) await p.screenshot({ path: join(PRINTS, 'menu-modal-pendencias.png') })
  const destinos = []
  for (let i = 0; i < n; i++) {
    if (i > 0) { await p.getByTestId('menu-alerta').click(); await p.getByRole('dialog').waitFor() }
    const texto = await p.getByRole('dialog').getByTestId('pendencia-resolver').nth(i).innerText()
    await p.getByRole('dialog').getByTestId('pendencia-resolver').nth(i).click()
    await p.waitForTimeout(800)
    destinos.push(`${texto.split('·')[1]?.trim()} → ${new URL(p.url()).pathname}`)
  }
  ok('cada "Resolver" leva para a tela certa', destinos.every((d) => d.includes('/admin/')), destinos.join(' | '))

  await db.query(`update restaurantes set telefone=$2 where id=$1`, [loja.id, loja.telefone || '27999990000'])
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  await fecharModal(p)
  const depois = await p.getByTestId('menu-alerta-badge').innerText().then((t) => Number(t.replace(/\D/g, ''))).catch(() => 0)
  ok('resolver uma pendência diminui o número', depois === badge - 1, `${badge} → ${depois}`)
  await ctx.close()

  console.log('\n── notificações bloqueadas ──')
  const ctxN = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  await ctxN.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }) })
  const pN = await entrar(ctxN)
  await pN.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  await fecharModal(pN)
  ok('bloqueadas: sino cortado (estado negadas)', (await pN.getByTestId('menu-sino').getAttribute('data-estado')) === 'negadas')
  await pN.getByTestId('menu-sino').click()
  ok('   clique explica como liberar no navegador', /cadeado|Permitir/.test(await pN.getByTestId('menu-card-loja').innerText()))
  await ctxN.close()

  console.log('\n── celular 390 ──')
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'pt-BR', permissions: ['notifications'] })
  const pM = await entrar(ctxM)
  await pM.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  await fecharModal(pM)
  await pM.getByRole('button', { name: 'Abrir o menu' }).first().click()
  await pM.waitForTimeout(400)
  ok('gaveta: card com sino, alerta e botão de fechar', await pM.getByTestId('menu-sino').isVisible() && await pM.getByTestId('menu-alerta').isVisible() && await pM.getByRole('button', { name: 'Fechar o menu' }).isVisible())
  if (PRINTS) await pM.screenshot({ path: join(PRINTS, 'menu-celular.png') })
  await pM.getByTestId('menu-alerta').click()
  ok('   alerta abre o modal no celular', await pM.getByRole('dialog').isVisible())
  await ctxM.close()
} catch (e) {
  console.error(e); res.push(false)
} finally {
  await db.query(`update restaurantes set telefone=$2 where id=$1`, [loja.id, loja.telefone])
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
