/**
 * Etapa 0 — prova de isolamento entre lojas (migration 0080).
 *
 * Duas lojas da semente local (cantina-demo e vizinha-demo). Verifica, com JWT
 * real no PostgREST e pelas rotas do app, que:
 *   - loja A não lê o token do Assistente de Impressão da loja B (nem o próprio,
 *     pelo navegador);
 *   - loja A não alcança a fila de impressão da loja B;
 *   - dono, funcionário, visitante e token inválido ficam isolados;
 *   - o assistente legítimo continua funcionando;
 *   - a vitrine pública continua carregando, inclusive para quem está logado em
 *     outra loja.
 *
 * NUNCA imprime valor de token: compara igualdade em memória e mostra só ✅/❌.
 * Só loopback (banco e app locais).
 *
 *   npx supabase start
 *   node scripts/seguranca/servidor-local.mjs build && node scripts/seguranca/servidor-local.mjs start
 *   node scripts/seguranca/verificar-isolamento-lojas.mjs
 */

import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL, BASE)

execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })

const res = []
const ok = (nome, passou, detalhe) => {
  res.push(passou)
  console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe !== undefined && detalhe !== '' ? ` — ${detalhe}` : ''}`)
}
const secao = (t) => console.log(`\n── ${t} ──`)

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]

const lojaA = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const lojaB = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id

// Tokens de teste, gerados aqui e mantidos só em memória.
const tokenA = crypto.randomUUID()
const tokenB = crypto.randomUUID()
await db.query('update restaurantes set impressao_agente_token = $2 where id = $1', [lojaA, tokenA])
await db.query('update restaurantes set impressao_agente_token = $2 where id = $1', [lojaB, tokenB])
// Um pedido novo em cada loja para a fila de impressão ter conteúdo.
for (const loja of [lojaA, lojaB]) {
  await db.query(
    `insert into pedidos (restaurante_id, tipo, status, total, canal, cliente_nome, cliente_telefone, impresso)
     values ($1,'retirada','recebido',10,'delivery','Cliente Teste Isolamento','5500000000000',false)`,
    [loja],
  )
}

async function cliente(email) {
  const c = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
  if (email) {
    const { error } = await c.auth.signInWithPassword({ email, password: SENHA })
    if (error) throw new Error(`login ${email}: ${error.message}`)
  }
  return c
}

// ════════════════════════════════════════════════════════════════════════════
secao('Banco (PostgREST com JWT real)')
const donoA = await cliente('dono@local.test')
const atendenteA = await cliente('atendente@demo.local')
const donoB = await cliente('dono@vizinha.local')
const visitante = await cliente(null)

for (const [nome, c, propria, alheia] of [
  ['dono da loja A', donoA, lojaA, lojaB],
  ['atendente da loja A', atendenteA, lojaA, lojaB],
  ['dono da loja B', donoB, lojaB, lojaA],
]) {
  const { data: todas } = await c.from('restaurantes').select('id')
  ok(`${nome} enxerga só a própria loja`, (todas ?? []).length === 1 && todas[0].id === propria, `${(todas ?? []).length} linha(s)`)
  const { data: outra } = await c.from('restaurantes').select('id, nome, telefone').eq('id', alheia)
  ok(`${nome} não lê nenhuma coluna da outra loja`, (outra ?? []).length === 0)
  const { error: eToken } = await c.from('restaurantes').select('impressao_agente_token').eq('id', propria)
  ok(`${nome} não lê o token pelo navegador (nem o próprio)`, Boolean(eToken) && /permission/i.test(eToken.message))
  const { data: pedidosAlheios } = await c.from('pedidos').select('id').eq('restaurante_id', alheia)
  ok(`${nome} não lê pedidos da outra loja`, (pedidosAlheios ?? []).length === 0)
  const { data: clientesAlheios } = await c.from('clientes').select('telefone').eq('restaurante_id', alheia)
  ok(`${nome} não lê clientes da outra loja`, (clientesAlheios ?? []).length === 0)
}

{
  const { data: lojas } = await visitante.from('restaurantes').select('id, nome, slug').in('id', [lojaA, lojaB])
  ok('visitante (anon) ainda lê as colunas públicas das vitrines', (lojas ?? []).length === 2)
  const { error: eTok } = await visitante.from('restaurantes').select('impressao_agente_token').eq('id', lojaA)
  ok('visitante não lê o token', Boolean(eTok) && /permission/i.test(eTok.message))
  const { error: eEvo } = await visitante.from('restaurantes').select('evolution_instance').eq('id', lojaA)
  ok('visitante não lê a instância do WhatsApp', Boolean(eEvo) && /permission/i.test(eEvo.message))
}

{
  const { error: eCfg } = await donoA.from('restaurantes').update({ impressao_automatica: true }).eq('id', lojaA)
  ok('dono da loja A continua salvando a configuração de impressão', !eCfg, eCfg?.message)
  const { error: eGrava } = await donoA.from('restaurantes').update({ impressao_agente_token: crypto.randomUUID() }).eq('id', lojaA)
  ok('navegador não consegue sobrescrever o token', Boolean(eGrava) && /permission/i.test(eGrava.message))
  const atual = await um('select impressao_agente_token = $2 as igual from restaurantes where id = $1', [lojaA, tokenA])
  ok('o token da loja A continua o mesmo depois da tentativa', atual.igual === true)
}

{
  // Coluna nova sem grant quebraria o painel sem aviso: este teste existe para isso.
  const faltando = (
    await db.query(`
      select c.column_name from information_schema.columns c
       where c.table_schema='public' and c.table_name='restaurantes' and c.column_name <> 'impressao_agente_token'
         and not has_column_privilege('authenticated', 'public.restaurantes', c.column_name, 'SELECT')`)
  ).rows.map((r) => r.column_name)
  ok('o painel tem SELECT em toda coluna de restaurantes, menos o token', faltando.length === 0, faltando.join(', '))
  const tokenLivre = await um(`select has_column_privilege('authenticated','public.restaurantes','impressao_agente_token','SELECT') as sel,
                                     has_column_privilege('authenticated','public.restaurantes','impressao_agente_token','UPDATE') as upd`)
  ok('authenticated não tem SELECT nem UPDATE no token', !tokenLivre.sel && !tokenLivre.upd)
}

// ════════════════════════════════════════════════════════════════════════════
secao('Assistente de Impressão (rota /api/agente/pedidos)')
async function fila(token) {
  const r = await fetch(`${BASE}/api/agente/pedidos`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  let json = null
  try {
    json = await r.json()
  } catch {
    /* sem corpo */
  }
  return { status: r.status, json }
}
{
  const a = await fila(tokenA)
  const idsA = (a.json?.pedidos ?? []).map((p) => p.id)
  const donos = idsA.length
    ? (await db.query('select distinct restaurante_id from pedidos where id = any($1::uuid[])', [idsA])).rows.map((r) => r.restaurante_id)
    : []
  ok('assistente legítimo da loja A recebe a fila', a.status === 200 && idsA.length > 0, `HTTP ${a.status}, ${idsA.length} pedido(s)`)
  ok('a fila da loja A só tem pedidos da loja A', donos.length === 1 && donos[0] === lojaA)
  const b = await fila(tokenB)
  const idsB = (b.json?.pedidos ?? []).map((p) => p.id)
  ok('a fila da loja B não contém nenhum pedido da loja A', idsB.every((id) => !idsA.includes(id)) && b.status === 200)
  ok('token inválido é recusado', (await fila(crypto.randomUUID())).status === 401)
  ok('sem token é recusado', [400, 401].includes((await fila(null)).status))
}

// ════════════════════════════════════════════════════════════════════════════
secao('Painel e vitrine (navegador de verdade)')
const { chromium } = await import('playwright')
const browser = await chromium.launch()
async function logar(usuario) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', usuario)
  await page.fill('input[name="password"]', SENHA)
  await Promise.all([
    page.waitForURL((u) => u.pathname.startsWith('/admin') || u.searchParams.has('error'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ])
  await page.waitForLoadState('networkidle').catch(() => {})
  return page
}
const chamar = (page, url, metodo = 'GET') =>
  page.evaluate(
    async ({ url, metodo }) => {
      const r = await fetch(url, { method: metodo, redirect: 'manual' })
      let json = null
      try {
        json = await r.json()
      } catch {
        /* sem corpo */
      }
      return { status: r.status, json }
    },
    { url: `${BASE}${url}`, metodo },
  )

{
  const paginaDonoA = await logar('dono.local')
  const lido = await chamar(paginaDonoA, '/api/admin/impressao/token')
  ok('dono da loja A lê o próprio token pela rota do servidor', lido.status === 200 && lido.json?.token === tokenA)

  const paginaAtendente = await logar('atendente.local')
  const negado = await chamar(paginaAtendente, '/api/admin/impressao/token')
  ok('atendente não lê o token', negado.status === 403 || negado.status === 307 || negado.status === 0, `HTTP ${negado.status}`)

  const anonimo = await fetch(`${BASE}/api/admin/impressao/token`, { redirect: 'manual' })
  ok('sem sessão não lê o token', anonimo.status !== 200, `HTTP ${anonimo.status}`)

  // Regerar: o antigo morre na hora, o novo passa a valer.
  const novo = await chamar(paginaDonoA, '/api/admin/impressao/token', 'POST')
  ok('dono regenera o token', novo.status === 200 && typeof novo.json?.token === 'string' && novo.json.token !== tokenA)
  ok('o token antigo deixa de funcionar na hora', (await fila(tokenA)).status === 401)
  ok('o token novo funciona no assistente', (await fila(novo.json?.token)).status === 200)
  const auditado = await um(
    `select count(*)::int n from eventos_auditoria where restaurante_id=$1 and acao='impressao.gerou_token' and criado_em > now() - interval '5 minutes'`,
    [lojaA],
  )
  ok('a troca do token fica na auditoria (sem o valor)', auditado.n >= 1)
  const semValor = await um(
    `select count(*)::int n from eventos_auditoria where restaurante_id=$1 and dados::text like '%' || $2 || '%'`,
    [lojaA, novo.json?.token ?? 'x'],
  )
  ok('o valor do token não aparece na auditoria', semValor.n === 0)

  // Ajustes › Impressão abre sem erro de permissão.
  const erros = []
  paginaDonoA.on('console', (m) => m.type() === 'error' && erros.push(m.text()))
  await paginaDonoA.goto(`${BASE}/admin/ajustes`, { waitUntil: 'networkidle' })
  await paginaDonoA.getByRole('button', { name: 'Impressão' }).first().click().catch(() => {})
  await paginaDonoA.waitForTimeout(1500)
  const texto = await paginaDonoA.locator('body').innerText()
  ok('Ajustes › Impressão carrega', /Assistente|Impress/i.test(texto))
  ok('sem "permission denied" no console', !erros.some((e) => /permission denied/i.test(e)), erros.slice(0, 2).join(' | '))

  // Vitrine: anônimo e logado em outra loja.
  const anon = await (await browser.newContext()).newPage()
  const r1 = await anon.goto(`${BASE}/loja/cantina-demo`, { waitUntil: 'networkidle' })
  ok('vitrine carrega para visitante', r1?.status() === 200 && /Cantina Demo/.test(await anon.locator('body').innerText()))
  const paginaDonoB = await logar('dono@vizinha.local')
  const r2 = await paginaDonoB.goto(`${BASE}/loja/cantina-demo`, { waitUntil: 'networkidle' })
  ok('vitrine da loja A carrega para o dono logado da loja B', r2?.status() === 200 && /Cantina Demo/.test(await paginaDonoB.locator('body').innerText()))
  const r3 = await paginaDonoA.goto(`${BASE}/loja/cantina-demo`, { waitUntil: 'networkidle' })
  ok('vitrine da própria loja carrega para o dono logado', r3?.status() === 200)
}
await browser.close()

// Não deixa token de teste conhecido no banco local.
await db.query('update restaurantes set impressao_agente_token = null where id = any($1::uuid[])', [[lojaA, lojaB]])
await db.end()

const falhas = res.filter((x) => !x).length
console.log(`\n${falhas ? '❌' : '✅'} ${res.length - falhas}/${res.length} verificações passaram\n`)
process.exit(falhas ? 1 : 0)
