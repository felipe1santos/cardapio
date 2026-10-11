/**
 * TESTE DE ISOLAMENTO ENTRE LOJAS — todas as tabelas e todas as rotas de API do painel (10/10/2026).
 *
 * Logado como o DONO da loja A (cantina-demo), tenta alcançar dados da loja B (vizinha-demo):
 *   1. BANCO (PostgREST com JWT real): para TODA tabela de `public` com coluna restaurante_id, lê as linhas da loja B
 *      (tem que vir 0) e tenta alterá-las (tem que alterar 0).
 *   2. ROTAS GET: todas as rotas de app/api/admin/**\/route.ts com GET, trocando cada [parâmetro] pelos ids da loja B.
 *      Nenhuma resposta pode trazer o MARCADOR plantado nos dados da B nem o id da loja B.
 *   3. ROTAS QUE ALTERAM (PATCH/PUT/DELETE/POST com [id] da B): depois de chamar todas, os dados da B têm que estar
 *      iguais aos de antes (hash por tabela).
 * FALHA (exit 1) se conseguir qualquer coisa. Só loopback (banco e app locais) — nunca produção.
 *
 *   npx supabase start
 *   node scripts/seguranca/servidor-local.mjs build && node scripts/seguranca/servidor-local.mjs start
 *   node scripts/seguranca/isolamento-todas-rotas.mjs
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const SENHA = 'demo-local-123456'
const { DB_URL, API_URL, ANON_KEY } = chavesLocais()
exigirLoopback(DB_URL, API_URL, BASE)
execFileSync(process.execPath, ['scripts/seguranca/semear-demo-mesas.mjs'], { stdio: 'ignore' })

let falhas = 0
const ok = (nome, passou, detalhe = '') => { if (!passou) falhas++; if (!passou || process.env.VERBOSO) console.log(`   ${passou ? '✅' : '❌'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`) }

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const A = (await um(`select id from restaurantes where slug='cantina-demo'`)).id
const B = (await um(`select id from restaurantes where slug='vizinha-demo'`)).id

// ── Dados da loja B com um marcador único (só no banco local) ────────────────────────────────────────────────
const MARCADOR = `VAZOU-${randomUUID().slice(0, 8)}`
const pedidoB = (await um(`insert into pedidos (restaurante_id, numero, tipo, status, forma_pagamento, subtotal, total, cliente_nome, cliente_telefone, observacao, origem)
  values ($1, 990000 + floor(random()*9999)::int, 'retirada', 'recebido', 'pix', 10, 10, $2, '5527900000999', $2, 'cardapio') returning id`, [B, MARCADOR])).id
const clienteB = (await um(`insert into clientes (restaurante_id, telefone, nome) values ($1, '5527900000999', $2)
  on conflict (restaurante_id, telefone) do update set nome = excluded.nome returning id`, [B, MARCADOR])).id
const grupoB = (await um(`select id from grupos_cardapio where restaurante_id=$1 limit 1`, [B]))?.id
const itemB = grupoB ? (await um(`insert into itens_cardapio (restaurante_id, grupo_id, nome, preco, status) values ($1,$2,$3,10,'disponivel') returning id`, [B, grupoB, MARCADOR])).id : null
const tentar = async (sql, p) => { try { return (await um(sql, p))?.id ?? null } catch { return null } }
const conversaB = await tentar(`insert into whatsapp_conversas (restaurante_id, telefone, nome_contato) values ($1, '5527900000998', $2)
  on conflict (restaurante_id, telefone) do update set nome_contato = excluded.nome_contato returning id`, [B, MARCADOR])
const comandaB = await tentar(`select id from comandas where restaurante_id=$1 limit 1`, [B])
const qualquerDaB = async (tabela) => tentar(`select id from public."${tabela}" where restaurante_id=$1 limit 1`, [B])
/** id da loja B da MESMA entidade da rota, pelo segmento antes de [id]. */
const ID_POR_SEGMENTO = {
  pedidos: pedidoB, clientes: clienteB, cardapio: itemB, itens: itemB, conversas: conversaB, comandas: comandaB,
  campanhas: await qualquerDaB('campanhas'), avulsas: await qualquerDaB('push_avulsas'), importacoes: await qualquerDaB('clientes_importacoes'),
  mesas: await qualquerDaB('mesas'), entregadores: await qualquerDaB('entregadores'), equipe: await tentar(`select id from usuarios where restaurante_id=$1 limit 1`, [B]),
  cupons: await qualquerDaB('cupons'), fidelidade: await qualquerDaB('fidelidade_campanhas'), contas: await qualquerDaB('fin_contas'),
  comanda: comandaB, pedido: pedidoB, caixa: await qualquerDaB('fin_caixas'), turno: await qualquerDaB('fin_turnos'),
  insumos: await qualquerDaB('fin_insumos'), agentes: await qualquerDaB('impressao_agentes'), dispositivos: await qualquerDaB('impressao_dispositivos'),
}
// Segmento sem linha da B no banco local: usa um id que não existe (a rota tem que responder sem dado nenhum).
for (const k of Object.keys(ID_POR_SEGMENTO)) ID_POR_SEGMENTO[k] ??= randomUUID()

// Tabelas com restaurante_id (todas as de public)
const tabelas = (await db.query(`select table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
  where c.table_schema='public' and c.column_name='restaurante_id' and t.table_type='BASE TABLE' order by 1`)).rows.map((r) => r.table_name)
const hashDaB = async () => {
  const h = {}
  for (const t of tabelas) {
    const rows = (await db.query(`select * from public."${t}" where restaurante_id=$1 order by 1`, [B])).rows
    h[t] = createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
  }
  return h
}

// ── 1. Banco (PostgREST, JWT do dono da A) ───────────────────────────────────────────────────────────────────
console.log(`\n── 1. Banco: ${tabelas.length} tabelas com restaurante_id ──`)
const donoA = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
{ const { error } = await donoA.auth.signInWithPassword({ email: 'dono@local.test', password: SENHA }); if (error) throw new Error(`login A: ${error.message}`) }
const visitante = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
const publicas = []
const antesBanco = await hashDaB()
let tabelasLidas = 0
for (const t of tabelas) {
  const { data, error } = await donoA.from(t).select('*').eq('restaurante_id', B).limit(5)
  if (!error) tabelasLidas++
  let viu = error ? 0 : (data ?? []).length
  // Catálogo PÚBLICO de propósito (a vitrine anônima lê o cardápio de toda loja): se até o visitante sem login lê a
  // mesma linha, não é vazamento — só registra. Qualquer outra tabela com linha da B = vazamento.
  if (viu > 0) {
    const { data: anon } = await visitante.from(t).select('*').eq('restaurante_id', B).limit(5)
    if ((anon ?? []).length > 0) { publicas.push(t); viu = 0 }
  }
  ok(`${t}: A não lê linhas da B`, viu === 0, error ? `sem acesso (${error.code ?? 'erro'})` : `${viu} linha(s)`)
  // tenta alterar (nada pode mudar)
  await donoA.from(t).update({ restaurante_id: B }).eq('restaurante_id', B)
  await donoA.from(t).delete().eq('restaurante_id', B)
}
const depoisBanco = await hashDaB()
for (const t of tabelas) ok(`${t}: dados da B intactos após update/delete da A`, antesBanco[t] === depoisBanco[t])
console.log(`   ${tabelas.length} tabelas conferidas (${tabelasLidas} legíveis pela A). Públicas de propósito (vitrine, até o visitante lê): ${publicas.join(', ') || 'nenhuma'}.`)

// ── 2 e 3. Rotas do app ────────────────────────────────────────────────────────────────────────────────────
function rotas(dir, base = 'app/api/admin') {
  const lista = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) lista.push(...rotas(p, base))
    else if (nome === 'route.ts') lista.push(p.replace(/\\/g, '/'))
  }
  return lista
}
const arquivos = rotas('app/api/admin')
const { chromium } = await import('playwright')
const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[name="email"]', 'dono@local.test')
await page.fill('input[name="password"]', SENHA)
await Promise.all([page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')])
const chamar = (url, metodo) => page.evaluate(async ({ url, metodo }) => {
  const r = await fetch(url, { method: metodo, redirect: 'manual', headers: metodo === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: metodo === 'GET' ? undefined : '{}' })
  return { status: r.status, texto: (await r.text()).slice(0, 200000) }
}, { url, metodo })

const urlDe = (arq) => arq.replace(/^app/, '').replace(/\/route\.ts$/, '').replace(/([\w-]+)\/\[id\]/g, (_, seg) => `${seg}/${ID_POR_SEGMENTO[seg] ?? pedidoB}`)
console.log(`\n── 2. Rotas GET (${arquivos.length} arquivos de rota) ──`)
let gets = 0
for (const arq of arquivos) {
  const src = readFileSync(arq, 'utf8')
  if (!/export (async )?function GET|export const GET/.test(src)) continue
  gets++
  const r = await chamar(`${BASE}${urlDe(arq)}`, 'GET')
  ok(`GET ${urlDe(arq)}`, !r.texto.includes(MARCADOR) && !r.texto.includes(B), `HTTP ${r.status}${r.texto.includes(MARCADOR) ? ' — TROUXE DADO DA LOJA B' : r.texto.includes(B) ? ' — TROUXE O ID DA LOJA B' : ''}`)
}
console.log(`   ${gets} rotas GET chamadas como a loja A.`)

console.log('\n── 3. Rotas que alteram, com ids da loja B ──')
const antesRotas = await hashDaB()
let mut = 0
for (const arq of arquivos.filter((a) => /\[\w+\]/.test(a))) {
  const src = readFileSync(arq, 'utf8')
  for (const m of ['PATCH', 'PUT', 'DELETE', 'POST']) {
    if (!new RegExp(`export (async )?function ${m}|export const ${m}`).test(src)) continue
    mut++
    const r = await chamar(`${BASE}${urlDe(arq)}`, m)
    ok(`${m} ${urlDe(arq)} não expõe a B`, !r.texto.includes(MARCADOR), `HTTP ${r.status}`)
  }
}
const depoisRotas = await hashDaB()
for (const t of tabelas) ok(`${t}: dados da B intactos após ${mut} chamadas que alteram`, antesRotas[t] === depoisRotas[t])
console.log(`   ${mut} chamadas que alteram, com ids da loja B.`)

await browser.close()
// limpa o marcador
await db.query('delete from pedidos where id=$1', [pedidoB])
if (conversaB) await db.query('delete from whatsapp_conversas where id=$1', [conversaB])
if (itemB) await db.query('delete from itens_cardapio where id=$1', [itemB])
await db.end()
console.log(falhas ? `\n❌ ${falhas} VAZAMENTO(S) OU FALHA(S)` : '\n✅ Isolamento entre lojas: nenhum dado da loja B alcançado pela loja A.')
process.exit(falhas ? 1 : 0)
