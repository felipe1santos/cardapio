/**
 * Tela Impressão: rolagem até o fim, sem rolagem horizontal, em 6 larguras — e o guia do
 * Beta com uma loja montada como a Villa Lanches (Beta liberado, o MESMO computador
 * pareado duas vezes, o antigo sem sinal, impressoras virtuais do Windows).
 * Só stack local; nada é impresso (nenhum trabalho é criado).
 *
 *   SHOTS=<pasta> node scripts/seguranca/shots-impressao-rolagem.mjs
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SHOTS = process.env.SHOTS
if (!SHOTS) { console.error('SHOTS=<pasta>'); process.exit(2) }
const { DB_URL, API_URL, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE, API_URL)
mkdirSync(SHOTS, { recursive: true })
const SENHA = 'demo-local-123456'
const LARGURAS = [360, 390, 412, 768, 1366, 1920]

const res = []
const ok = (n, c, d = '') => { res.push({ n, c: !!c }); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── loja como a Villa ────────────────────────────────────────────────────────
const L = (await um(`insert into restaurantes (nome, slug, status_loja) values ('Lanches Impressão E2E','imp-e2e-a','aberto_manual')
  on conflict (slug) do update set nome=excluded.nome returning id`)).id
await db.query(`delete from impressao_trabalhos where restaurante_id=$1`, [L])
await db.query(`delete from impressao_funcoes where restaurante_id=$1`, [L])
await db.query(`delete from impressao_agentes where restaurante_id=$1`, [L])
await db.query(`update restaurantes set impressao_beta_liberado=true, impressao_beta_modo='teste', impressao_cozinha_transferida_em=null where id=$1`, [L])
const hash = () => createHash('sha256').update(randomBytes(16)).digest('hex')
const antigo = (await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_em, criado_por_nome)
  values ($1,'PC-PRINCIPAL',$2,'0.2.0-beta.1', now()-interval '30 minutes', now()-interval '1 day','dono') returning id`, [L, hash()])).id
const novo = (await um(`insert into impressao_agentes (restaurante_id, nome, credencial_hash, versao, visto_em, criado_em, criado_por_nome)
  values ($1,'PC-PRINCIPAL',$2,'0.2.0-beta.1', now(), now()-interval '25 minutes','dono') returning id`, [L, hash()])).id
for (const [ag, visto] of [[antigo, "now()-interval '30 minutes'"], [novo, 'now()']]) {
  for (const nome of ['Microsoft XPS Document Writer', 'Microsoft Print to PDF', 'Fax', 'OneNote for Windows 10', 'POS-80', 'POS80-USB/COZINHA']) {
    await db.query(`insert into impressao_dispositivos (restaurante_id, agente_id, nome_sistema, visto_em, apelido) values ($1,$2,$3,${visto},$4)`,
      [L, ag, nome, ag === antigo && nome === 'POS-80' ? 'cozinhaaa' : null])
  }
}
let uid
{
  const email = 'dono@imp-e2e.local'
  const { data, error } = await admin.auth.admin.createUser({ email, password: SENHA, email_confirm: true })
  if (error && !/already/i.test(error.message)) throw error
  uid = data?.user?.id
  if (!uid) { const { data: l } = await admin.auth.admin.listUsers({ perPage: 1000 }); uid = l.users.find((u) => u.email === email).id; await admin.auth.admin.updateUserById(uid, { password: SENHA }) }
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'dono','Dono Imp','dono@imp-e2e.local','dono.impa',true)
    on conflict (id) do update set restaurante_id=excluded.restaurante_id, papel='dono', autorizado=true, desativado_em=null`, [uid, L])
}

const browser = await chromium.launch()
try {
  for (const largura of LARGURAS) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: largura < 800 ? 780 : 900 }, locale: 'pt-BR', isMobile: largura < 800, hasTouch: largura < 800 })
    const p = await ctx.newPage()
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.fill('input[name="email"]', 'dono.impa')
    await p.fill('input[name="password"]', SENHA)
    await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
    await p.goto(`${BASE}/admin/impressao`, { waitUntil: 'networkidle' })
    const b = p.getByRole('button', { name: /OK, entendi/ }).first(); await b.waitFor({ timeout: 2500 }).catch(() => {}); if (await b.isVisible().catch(() => false)) await b.click()
    await p.getByTestId('guia-beta').waitFor({ timeout: 15000 })
    await p.waitForTimeout(700)
    await p.screenshot({ path: join(SHOTS, `impressao-${largura}-topo.png`) })

    // Rola o contêiner até o fim, como a roda do mouse / o dedo fariam.
    const rol = await p.evaluate(async () => {
      const c = document.querySelector('[data-testid=impressao-rolagem]')
      const antes = c.scrollTop
      c.scrollTo({ top: c.scrollHeight })
      await new Promise((r) => setTimeout(r, 300))
      const ultimo = [...document.querySelectorAll('[data-testid=painel-impressao] > section')].at(-1)
      const r = ultimo.getBoundingClientRect()
      return { rola: c.scrollHeight > c.clientHeight, moveu: c.scrollTop > antes, fimVisivel: r.bottom <= window.innerHeight + 1 && r.top < window.innerHeight, titulo: ultimo.querySelector('h2')?.textContent ?? '' }
    })
    ok(`${largura}px: rola e chega ao fim (${rol.titulo.trim()})`, rol.rola && rol.moveu && rol.fimVisivel && /Diagn/.test(rol.titulo), JSON.stringify(rol))
    // Roda do mouse de verdade no meio da página (desktop).
    if (largura >= 800) {
      await p.evaluate(() => document.querySelector('[data-testid=impressao-rolagem]').scrollTo({ top: 0 }))
      await p.mouse.move(largura / 2 + 100, 500)
      await p.mouse.wheel(0, 1200)
      await p.waitForTimeout(400)
      ok(`${largura}px: roda do mouse rola o conteúdo`, (await p.evaluate(() => document.querySelector('[data-testid=impressao-rolagem]').scrollTop)) > 300)
    }
    const larg = await p.evaluate(() => {
      const w = window.innerWidth
      const fixo = (e) => { for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).position === 'fixed') return true; return false }
      const fora = [...document.querySelectorAll('[data-testid=painel-impressao] *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !fixo(e) })
      return { doc: document.documentElement.scrollWidth, w, fora: fora.slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30)) }
    })
    ok(`${largura}px: sem rolagem horizontal`, larg.doc <= larg.w + 1 && larg.fora.length === 0, larg.fora.join(' | '))
    await p.screenshot({ path: join(SHOTS, `impressao-${largura}-fim.png`) })

    if (largura === 1366) {
      await p.evaluate(() => document.querySelector('[data-testid=impressao-rolagem]').scrollTo({ top: 0 }))
      const passos = await p.$$eval('[data-testid=guia-passos] > li', (ls) => ls.map((l) => l.getAttribute('data-feito')))
      ok('guia: pareado e online marcados; funções, teste e modo ainda por fazer', passos.join(',') === 'sim,sim,sim,sim,nao,nao,nao,nao', passos.join(','))
      ok('pareamento antigo destacado com a orientação de desconectar', await p.getByTestId('agente-antigo-PC-PRINCIPAL').isVisible())
      const opcoes = await p.$$eval('[data-testid=funcao-cozinha] option', (os) => os.map((o) => o.textContent))
      ok('escolha da Cozinha: sem impressoras do pareamento antigo; térmicas antes das virtuais',
        opcoes.length === 7 && !opcoes.some((o) => /pareamento antigo|cozinhaaa/.test(o)) && /POS/.test(opcoes[1]) && /POS/.test(opcoes[2]) && /virtual/.test(opcoes.at(-1)), opcoes.join(' | '))
      ok('texto do Beta: sem token, código temporário, impressoras do Windows', /Não usa token/.test(await p.getByTestId('guia-beta').innerText()) && /já instaladas no Windows/.test(await p.getByTestId('guia-beta').innerText()))
      await p.screenshot({ path: join(SHOTS, 'impressao-1366-pagina.png'), fullPage: false })
    }
    await ctx.close()
  }
  const trabalhos = await um(`select count(*)::int n from impressao_trabalhos where restaurante_id=$1`, [L])
  ok('nenhum trabalho de impressão criado pela verificação', trabalhos.n === 0)
} catch (e) {
  ok(`execução sem exceção: ${e.message}`, false)
} finally {
  await browser.close()
  await db.end()
}
const f = res.filter((x) => !x.c)
console.log(`\n${res.length - f.length}/${res.length} verificações passaram`)
if (f.length) process.exit(1)
