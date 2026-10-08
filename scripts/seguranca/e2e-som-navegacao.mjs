/**
 * E2E — "Toque para ativar o som" só UMA vez por abertura do painel (2026-10-08).
 * O navegador exige um toque por CARREGAMENTO de página; trocar de tela sem recarregar mantém o
 * áudio liberado. Antes, o selo "Caixa" do topo, links do financeiro, Fidelidade, Ajustes e
 * Campanhas faziam recarga inteira — e o aviso voltava. Aqui: libera com 1 toque e navega pelos
 * caminhos que recarregavam; a página não pode recarregar e o aviso não pode voltar.
 * Loja local fin-int (financeiro ligado: o selo "Caixa" aparece no topo).
 *   node scripts/seguranca/e2e-som-navegacao.mjs
 */
import pg from 'pg'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais(); exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL }); await db.connect()
let falhas = 0, total = 0
const ok = (n, c, d = '') => { total++; if (!c) falhas++; console.log(`   ${c ? '✅' : '❌'} ${n}${d && !c ? ` — ${d}` : ''}`) }
const loja = await (await db.query(`select id, financeiro_ativo from restaurantes where slug='fin-int'`)).rows[0]
await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])
const b = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] })
try {
  const ctx = await b.newContext({ locale: 'pt-BR', viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.finint'); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/pedidos`, { waitUntil: 'networkidle' })
  const aviso = () => p.getByTestId('som-bloqueado').isVisible().catch(() => false)
  await p.waitForTimeout(1500)
  ok('abriu o painel: o navegador pede o toque (aviso aparece)', await aviso())
  await p.mouse.click(700, 450)
  await p.waitForTimeout(800)
  ok('1 toque: aviso some', !(await aviso()))
  await p.evaluate(() => { window.__semRecarga = 'marca' })
  const semRecarga = () => p.evaluate(() => window.__semRecarga === 'marca')
  const fechar = async () => { await p.keyboard.press("Escape").catch(() => {}); for (const t of ["Agora não", "Depois", "OK, entendi"]) await p.getByRole("button", { name: t }).first().click({ timeout: 300 }).catch(() => {}) }
  const passo = async (nome, acao, destino) => {
    await fechar()
    await acao()
    await p.waitForURL((u) => u.pathname + u.search === destino || u.pathname === destino.split('?')[0], { timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(1500)
    ok(`${nome}: sem recarregar a página e sem pedir o som de novo`, (await semRecarga()) && !(await aviso()), `${p.url()} recarga=${!(await semRecarga())} aviso=${await aviso()}`)
  }
  await passo('selo "Caixa" do topo', () => p.getByTestId('aviso-caixa').click(), '/admin/financeiro?secao=caixa')
  await passo('menu lateral → Cardápio', () => p.locator('a[href="/admin/cardapio"]:visible').first().click(), '/admin/cardapio')
  await passo('link antigo Campanhas ?aba=modelos → Ajustes', () => p.evaluate(() => { window.history.pushState(null, '', '/admin/pedidos') }).then(() => p.locator('a[href="/admin/campanhas"]:visible').first().click()), '/admin/campanhas')
  await passo('Fidelidade', () => p.locator('a[href="/admin/fidelidade"]:visible').first().click(), '/admin/fidelidade')
  const atalho = p.locator('[data-atalho-notificacoes], a[href="/admin/ajustes?aba=notificacoes"]').first()
  if (await atalho.count()) await passo('Fidelidade → Notificações (Ajustes)', () => atalho.click(), '/admin/ajustes?aba=notificacoes')
  await passo('volta ao Painel de Pedidos', () => p.locator('a[href="/admin/pedidos"]:visible').first().click(), '/admin/pedidos')
} catch (e) {
  falhas++; console.error('ERRO', String(e?.message ?? e).slice(0, 600)); await b.contexts()[0]?.pages()[0]?.screenshot({ path: '.medidas/som-erro.png' }).catch(() => {})
} finally {
  await db.query(`update restaurantes set financeiro_ativo=$2 where id=$1`, [loja.id, loja.financeiro_ativo])
  await b.close(); await db.end()
  console.log(`\n${total - falhas}/${total} ok${falhas ? ` — ${falhas} FALHA(S)` : ''}`)
  process.exit(falhas ? 1 : 0)
}
