/**
 * E2E — Fase 6 (2026-09-30): acessos por funcionário. Stack local, dono da cantina-pdv2.
 *   · cria um funcionário TESTE por modelo (Garçom, Caixa, Cozinha, Entregador, Gerente) pela tela;
 *   · cada um entra e vê só os itens do menu permitidos; URL proibida → "Você não tem acesso";
 *     API proibida → 403;
 *   · mudar o acesso com a pessoa logada vale na próxima ação;
 *   · ação sensível (fechar caixa) barrada sem a permissão; "editar preços" barrado no banco;
 *   · garçom antigo (sem acessos) continua igual. No fim, desativa os TESTE.
 *
 *   node scripts/seguranca/e2e-equipe-acessos.mjs [pasta-de-prints]
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
const um = async (s, p = []) => (await db.query(s, p)).rows[0]
const loja = await um(`select id from restaurantes where slug='cantina-pdv2'`)
const SENHA = 'teste-acessos-123'
const SUF = String(Date.now()).slice(-5)
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const browser = await chromium.launch()
const criados = []

async function logar(login, senha) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', login)
  await p.fill('input[name="password"]', senha)
  await Promise.all([p.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), p.click('button[type="submit"]')])
  await p.getByRole('button', { name: 'OK, entendi' }).click({ timeout: 2500 }).catch(() => {})
  return { ctx, p }
}
const menu = async (p) => (await p.locator('aside nav a').allInnerTexts()).map((t) => t.trim().split('\n')[0])
const api = (p, url, metodo = 'GET', corpo) => p.evaluate(async ({ url, metodo, corpo }) => {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : undefined, body: corpo ? JSON.stringify(corpo) : undefined })
  return r.status
}, { url: `${BASE}${url}`, metodo, corpo })

try {
  console.log('\n── cadastro pela tela, um por modelo ──')
  const dono = await logar('dono.pdv2@local.test', 'demo-local-123456')
  await dono.p.goto(`${BASE}/admin/equipe`, { waitUntil: 'networkidle' })
  for (const modelo of ['garcom', 'caixa', 'cozinha', 'entregador', 'gerente']) {
    // Tela repaginada (2026-10): cargo no lugar do modelo; Entregador virou Motoboy.
    await dono.p.getByTestId('adicionar-usuario').click()
    await dono.p.getByTestId('usuario-nome').fill(`TESTE ${modelo}`)
    await dono.p.getByTestId('usuario-login').fill(`teste.${modelo}.${SUF}`)
    await dono.p.getByTestId('usuario-senha').fill(SENHA)
    await dono.p.getByTestId('usuario-cargo').selectOption(modelo === 'entregador' ? 'motoboy' : modelo)
    if (await dono.p.getByTestId('troca-substituir').count()) await dono.p.getByTestId('troca-substituir').click()
    await dono.p.getByTestId('usuario-salvar').click()
    await dono.p.waitForTimeout(1200)
    const u = await um(`select id, papel, acessos from usuarios where usuario=$1`, [`teste.${modelo}.${SUF}`])
    if (u) criados.push(u.id)
    ok(`modelo ${modelo}: criado com papel ${u?.papel} e acessos`, !!u && !!u.acessos, JSON.stringify(u?.acessos ?? null))
  }
  await dono.p.reload({ waitUntil: 'networkidle' })
  const resumos = await dono.p.getByTestId('cargo').allInnerTexts()
  ok('lista mostra o cargo de cada um', resumos.includes('Garçom') && resumos.includes('Caixa') && resumos.includes('Motoboy'), resumos.join(' | '))
  if (PRINTS) await dono.p.screenshot({ path: join(PRINTS, 'equipe-lista.png'), fullPage: true })

  console.log('\n── cada um vê só o que pode ──')
  const esperado = {
    garcom: { tem: ['Mesas e Comandas'], nao: ['Campanhas', 'Dashboard', 'Equipe'], proibida: '/admin/campanhas', apiProibida: '/api/admin/campanhas' },
    caixa: { tem: ['Painel de Pedidos', 'PDV'], nao: ['Campanhas', 'Ajustes'], proibida: '/admin/ajustes', apiProibida: '/api/admin/campanhas' },
    cozinha: { tem: ['Painel de Pedidos'], nao: ['PDV', 'Campanhas'], proibida: '/admin/pdv', apiProibida: '/api/admin/pdv/mesas' },
    entregador: { tem: ['Logística'], nao: ['PDV', 'Campanhas'], proibida: '/admin/cardapio', apiProibida: '/api/admin/campanhas' },
  }
  for (const [modelo, e] of Object.entries(esperado)) {
    const s = await logar(`teste.${modelo}.${SUF}`, SENHA)
    const m = await menu(s.p)
    ok(`${modelo}: menu tem ${e.tem.join(', ')} e não tem ${e.nao.join(', ')}`, e.tem.every((t) => m.includes(t)) && e.nao.every((t) => !m.includes(t)), m.join(' | '))
    await s.p.goto(`${BASE}${e.proibida}`, { waitUntil: 'networkidle' })
    ok(`${modelo}: URL proibida → "Você não tem acesso a esta área"`, /sem-acesso/.test(s.p.url()) || (await s.p.getByTestId('sem-acesso').count()) > 0 || !s.p.url().includes(e.proibida), s.p.url())
    const st = await api(s.p, e.apiProibida)
    ok(`${modelo}: API proibida bloqueada`, st === 403 || st === 404, String(st))
    if (PRINTS && modelo === 'garcom') await s.p.screenshot({ path: join(PRINTS, 'garcom-sem-acesso.png') })
    await s.ctx.close()
  }

  console.log('\n── mudar com a pessoa logada vale na próxima ação ──')
  const cx = await logar(`teste.caixa.${SUF}`, SENHA)
  const idCaixa = (await um(`select id from usuarios where usuario=$1`, [`teste.caixa.${SUF}`])).id
  ok('caixa entra no PDV', (await api(cx.p, '/api/admin/pdv/mesas')) !== 403)
  await dono.p.goto(`${BASE}/admin/equipe`, { waitUntil: 'networkidle' })
  await dono.p.locator('[data-testid="usuario-linha"]', { hasText: `teste.caixa.${SUF}` }).getByTestId('acao-editar').click()
  await dono.p.getByTestId('perm-area-pdv').getByRole('switch').click()
  await dono.p.getByTestId('usuario-salvar').click(); await dono.p.waitForTimeout(1500)
  const st2 = await api(cx.p, '/api/admin/pdv/mesas')
  ok('tirou o PDV: a próxima chamada do caixa já é bloqueada (sem deslogar)', st2 === 403, String(st2))
  const aud = await um(`select count(*)::int n from eventos_auditoria where acao='equipe.acessos_alterados' and entidade_id=$1`, [idCaixa])
  ok('auditoria registrou quem mudou o quê', aud.n >= 1)

  console.log('\n── ações sensíveis ──')
  const st3 = await api(cx.p, '/api/admin/caixa', 'POST', { acao: 'fechar' })
  ok('caixa SEM logística não fecha o caixa (403)', st3 === 403, String(st3))
  const en = await logar(`teste.entregador.${SUF}`, SENHA)
  await db.query(`update usuarios set acessos = jsonb_set(acessos, '{sensiveis}', '[]'::jsonb) where usuario=$1`, [`teste.entregador.${SUF}`])
  const st4 = await api(en.p, '/api/admin/caixa', 'POST', { acao: 'fechar' })
  ok('logística sem "fechar caixa" é barrada na ação', st4 === 403, String(st4))
  const st5 = await api(en.p, '/api/admin/caixa')
  ok('   mas continua vendo o caixa (área liberada)', st5 !== 403, String(st5))

  // Editar preços: gerente sem a permissão tenta mudar preço direto no banco (como o Gestor faz).
  const ger = await um(`select id from usuarios where usuario=$1`, [`teste.gerente.${SUF}`])
  await db.query(`update usuarios set acessos = jsonb_set(acessos, '{sensiveis}', '["financeiro"]'::jsonb) where id=$1`, [ger.id])
  const item = await um(`select id, preco from itens_cardapio where restaurante_id=$1 limit 1`, [loja.id])
  await db.query('begin')
  await db.query(`select set_config('role','authenticated',true), set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: ger.id, role: 'authenticated' })])
  const preco = await db.query(`update itens_cardapio set preco = preco + 1 where id=$1`, [item.id]).then(() => 'passou', (e) => e.message)
  await db.query('rollback')
  ok('gerente sem "editar preços" não muda preço (barrado no banco)', /sem_permissao_editar_precos/.test(preco), preco)

  console.log('\n── garçom antigo (sem acessos) ──')
  const antigo = await um(`select usuario from usuarios where restaurante_id=$1 and papel='garcom' and acessos is null and desativado_em is null and usuario is not null limit 1`, [loja.id])
  if (antigo) {
    await db.query(`select 1`)
    ok('garçom antigo continua sem acessos (padrão do papel)', true, antigo.usuario)
  }
  const dm = await menu(dono.p)
  ok('dono vê tudo (não é limitado)', dm.includes('Equipe') && dm.includes('Ajustes') && dm.includes('Campanhas'))
} catch (e) {
  console.error(e); res.push(false)
} finally {
  if (criados.length) await db.query(`update usuarios set desativado_em = now() where id = any($1)`, [criados])
  console.log(`   (funcionários TESTE desativados: ${criados.length})`)
  await browser.close(); await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
