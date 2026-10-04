/**
 * Item 54 — pedidos de TESTE: fora das análises de loja real, dentro na loja de teste (menuzia).
 * Semeia sem e com `--com-teste` (2 pedidos de TESTE em cada loja), lê o total e o faturamento do bloco de
 * análises e confere a diferença. Só LOCAL. Termina semeando de novo SEM teste (estado das capturas).
 *
 *   node scripts/dashboard/limpeza-teste-54.mjs
 */
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from '../seguranca/chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
exigirLoopback(chavesLocais().DB_URL, BASE)
const semear = (...a) => execFileSync(process.execPath, ['scripts/dashboard/semear-54.mjs', ...a], { stdio: 'inherit' })

const browser = await chromium.launch()
async function ler(login) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login); await p.fill('input[name="password"]', 'demo-local-123456')
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' })
  await p.getByTestId('dash54-total').waitFor()
  await p.waitForTimeout(800)
  const texto = async (id) => (await p.getByTestId(id).innerText()).replace(/\s+/g, ' ')
  const r = { total: await texto('dash54-total'), faturamento: await texto('dash54-faturamento') }
  await ctx.close()
  return r
}

let falhas = 0
try {
  semear()
  const sem = { real: await ler('dono.dash54'), menuzia: await ler('dono.menuzialocal') }
  semear('--com-teste')
  const com = { real: await ler('dono.dash54'), menuzia: await ler('dono.menuzialocal') }
  console.log(JSON.stringify({ sem, com }, null, 1))
  const n = (s) => Number((s.match(/\d+/) ?? ['0'])[0])
  const igual = sem.real.total === com.real.total && sem.real.faturamento === com.real.faturamento
  console.log(`${igual ? '✅' : '❌'} loja real: pedidos de TESTE fora (total e faturamento iguais)`); if (!igual) falhas++
  const soma = n(com.menuzia.total) - n(sem.menuzia.total)
  console.log(`${soma === 2 ? '✅' : '❌'} menuzia: os 2 pedidos de TESTE continuam nas análises (+${soma})`); if (soma !== 2) falhas++
} finally {
  await browser.close()
  semear()
}
process.exit(falhas ? 1 : 0)
