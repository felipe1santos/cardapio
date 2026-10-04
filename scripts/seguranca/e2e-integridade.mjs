/**
 * E2E — Integridade do financeiro (0141): âncora externa do hash + pgaudit.
 * Simula o pior caso: o dono do banco (postgres) altera um lançamento e RECALCULA a cadeia inteira. A verificação
 * interna não vê nada; a âncora gravada fora do banco acusa. Loja própria TESTE ("integridade-e2e"), restaurada no fim.
 * Servidor local com ANCORA_DIR e CRON_SECRET (start-server.sh).
 *
 *   node scripts/seguranca/e2e-integridade.mjs
 */
import { execSync } from 'node:child_process'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3999'
const { DB_URL, API_URL, ANON_KEY, SERVICE_KEY } = chavesLocais()
exigirLoopback(DB_URL, BASE)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const q = async (s, p = []) => (await db.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } })
const res = []
const ok = (n, c, d = '') => { res.push(!!c); console.log(`   ${c ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`) }
const secao = (t) => console.log(`\n── ${t} ──`)
const SENHA = 'demo-local-123456'
const CRON = process.env.CRON_SECRET

// ── Loja e dono TESTE ──────────────────────────────────────────────────────────────────────
let loja = await um(`select id from restaurantes where slug='integridade-e2e'`)
if (!loja) loja = await um(`insert into restaurantes (nome, slug, financeiro_ativo) values ('TESTE Integridade', 'integridade-e2e', true) returning id`)
await db.query(`update restaurantes set financeiro_ativo=true where id=$1`, [loja.id])
const EMAIL = 'dono@integridade-e2e.local'
let dono = await um(`select id from usuarios where email=$1`, [EMAIL])
if (!dono) {
  const { data, error } = await admin.auth.admin.createUser({ email: EMAIL, password: SENHA, email_confirm: true })
  if (error) throw error
  await db.query(`insert into usuarios (id, restaurante_id, papel, nome, email, usuario, autorizado) values ($1,$2,'dono','TESTE Dono Integridade',$3,'dono.integridade',true)`, [data.user.id, loja.id, EMAIL])
  dono = { id: data.user.id }
}
const sb = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } })
const { data: sess } = await sb.auth.signInWithPassword({ email: EMAIL, password: SENHA })
const cookie = await (async () => {
  // Login pelo formulário real para ganhar o cookie de sessão do Next.
  const r = await fetch(`${BASE}/login`, { redirect: 'manual' })
  return r ? null : null
})()
void cookie; void sess

async function verificarComoDono() {
  const { chromium } = await import('playwright')
  const b = await chromium.launch()
  const ctx = await b.newContext()
  const p = await ctx.newPage()
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[name="email"]', 'dono.integridade'); await p.fill('input[name="password"]', SENHA)
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), p.click('button[type="submit"]')])
  const r = await p.evaluate(async () => { const x = await fetch('/api/admin/financeiro/auditoria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'verificar' }) }); return { s: x.status, j: await x.json().catch(() => null) } })
  await b.close()
  return r
}

// Lançamentos TESTE (pelo caminho normal: insert do service_role; o gatilho calcula o hash).
for (let i = 0; i < 4; i++) {
  const { error } = await admin.from('fin_lancamentos').insert({ restaurante_id: loja.id, grupo_id: crypto.randomUUID(), linha: 1, carteira: 'empresa', tipo: 'outro', valor_centavos: 100 + i, origem: 'manual', usuario_nome: 'TESTE', chave_idempotencia: `integ-${Date.now()}-${i}` })
  if (error) throw error
}

try {
  secao('1. Âncora diária fora do banco')
  const semSegredo = await fetch(`${BASE}/api/cron/ancora-integridade`, { method: 'POST' })
  ok('cron sem o segredo → 401', semSegredo.status === 401)
  const r = await fetch(`${BASE}/api/cron/ancora-integridade`, { method: 'POST', headers: { 'x-cron-secret': CRON } }).then(async (x) => ({ s: x.status, j: await x.json().catch(() => null) }))
  ok('cron grava a âncora de todas as lojas num arquivo', r.s === 200 && r.j?.lojas > 0 && /ancoras\.jsonl$/.test(r.j?.arquivo ?? ''), JSON.stringify(r.j))
  const v1 = await verificarComoDono()
  ok('verificação: íntegro e conferiu a âncora', v1.s === 200 && v1.j?.ok === true && v1.j?.ancora?.conferidas >= 1, JSON.stringify(v1.j?.ancora))

  secao('2. Ataque com a senha do banco: altera e RECALCULA a cadeia inteira')
  const alvo = await um(`select id, valor_centavos from fin_lancamentos where restaurante_id=$1 order by seq limit 1`, [loja.id])
  const originais = await q(`select id, valor_centavos, hash, hash_anterior from fin_lancamentos where restaurante_id=$1 order by seq`, [loja.id])
  const recalcular = `do $$
    declare l public.fin_lancamentos%rowtype; v_ant text := null; v_hash text;
    begin
      for l in select * from public.fin_lancamentos where restaurante_id = '${loja.id}' order by seq loop
        v_hash := public.fin_sha256(concat_ws('|', coalesce(v_ant, ''), l.restaurante_id, l.grupo_id, l.linha, l.turno_id,
          l.carteira, l.entregador_id, l.tipo, l.valor_centavos, l.forma, l.origem, l.pedido_id, l.comanda_id, l.pagamento_id,
          l.referencia_id, l.motivo, l.usuario_id, l.usuario_nome, l.aprovacao_id, l.chave_idempotencia,
          to_char(l.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')));
        update public.fin_lancamentos set hash_anterior = v_ant, hash = v_hash where id = l.id;
        v_ant := v_hash;
      end loop;
    end $$`
  await db.query(`update fin_lancamentos set valor_centavos = 999999 where id=$1`, [alvo.id])
  await db.query(recalcular)
  const interna = (await q(`select * from auditoria_verificar_cadeia($1)`, [loja.id]))
  ok('a verificação INTERNA não vê nada (é o limite conhecido)', interna.length === 0, JSON.stringify(interna))
  const v2 = await verificarComoDono()
  ok('a verificação com a ÂNCORA acusa: "cadeia reescrita"', v2.j?.ok === false && v2.j.problemas.some((p) => /cadeia reescrita|sumiu/.test(p.motivo)), JSON.stringify(v2.j?.problemas?.slice(0, 2)))

  secao('3. pgaudit registrou o ataque')
  const log = execSync('docker logs supabase_db_cardapio --since 3m 2>&1', { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 })
  ok('log do Postgres: AUDIT OBJECT de UPDATE em fin_lancamentos pelo postgres', /AUDIT: OBJECT,.*UPDATE,TABLE,public\.fin_lancamentos/.test(log))

  // Desfaz (local): volta valores e hashes originais.
  for (const o of originais) await db.query(`update fin_lancamentos set valor_centavos=$2, hash=$3, hash_anterior=$4 where id=$1`, [o.id, o.valor_centavos, o.hash, o.hash_anterior])
  ok('restaurado: íntegro de novo (interna e âncora)', (await q(`select * from auditoria_verificar_cadeia($1)`, [loja.id])).length === 0 && (await verificarComoDono()).j?.ok === true)
} catch (e) {
  ok('fluxo sem erro', false, String(e?.stack ?? e).slice(0, 400))
} finally {
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} verificações passaram`)
process.exit(falhas ? 1 : 0)
