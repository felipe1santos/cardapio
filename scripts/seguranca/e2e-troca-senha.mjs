/**
 * E2E — troca de senha (B16). Stack local, dono da cantina-pdv2.
 *   · Ajustes → Conta: senha atual errada é recusada (403); certa troca;
 *   · com o painel aberto (sessão comum), /redefinir-senha NÃO troca a senha sem o link do e-mail.
 * Volta a senha original no fim.
 *
 *   node scripts/seguranca/e2e-troca-senha.mjs      (servidor local em 127.0.0.1:3999)
 */
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const EMAIL = 'dono.pdv2@local.test'
const SENHA = 'demo-local-123456'
const NOVA = 'qa-nova-senha-7788'
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const browser = await chromium.launch()
async function entrar(senha) {
  const ctx = await browser.newContext({ locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', EMAIL)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin') || u.searchParams.has('error'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  return { p, ctx, entrou: new URL(p.url()).pathname.startsWith('/admin') }
}
const trocar = (p, atual, nova) => p.evaluate(async ({ atual, nova }) => {
  const r = await fetch('/api/admin/conta/senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ atual, nova }) })
  return r.status
}, { atual, nova })

let trocou = false
try {
  const { p } = await entrar(SENHA)
  ok('entra com a senha atual', new URL(p.url()).pathname.startsWith('/admin'))
  ok('senha atual errada: recusa (403)', (await trocar(p, 'errada-123', NOVA)) === 403)
  ok('sem senha atual: recusa (400)', (await trocar(p, '', NOVA)) === 400)

  // Sessão comum tentando o atalho da recuperação.
  await p.goto(`${BASE}/redefinir-senha`, { waitUntil: 'networkidle' })
  const campos = p.locator('input[type="password"]')
  if ((await campos.count()) >= 2) {
    await campos.nth(0).fill('atalho-sem-link-1')
    await campos.nth(1).fill('atalho-sem-link-1')
    await Promise.all([p.waitForURL(/recuperar-senha|login/, { timeout: 20000 }).catch(() => {}), p.locator('button[type="submit"]').click()])
  }
  ok('/redefinir-senha sem o link do e-mail manda pedir link', /recuperar-senha\?error=link-expirado/.test(p.url()), p.url())
  ok('   e a senha não mudou', (await entrar(SENHA)).entrou)

  const { p: p2 } = await entrar(SENHA)
  const st = await trocar(p2, SENHA, NOVA)
  trocou = st === 200
  ok('senha atual certa: troca (200)', trocou)
  ok('   entra com a nova', (await entrar(NOVA)).entrou)
  ok('   a antiga não entra mais', !(await entrar(SENHA)).entrou)
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (trocou) {
    const { p } = await entrar(NOVA)
    const volta = await trocar(p, NOVA, SENHA)
    console.log(`   (senha original restaurada: ${volta === 200 ? 'sim' : 'NÃO — status ' + volta})`)
  }
  await browser.close()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
