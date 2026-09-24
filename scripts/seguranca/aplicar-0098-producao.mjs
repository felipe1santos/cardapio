/**
 * Aplicador da migration 0098 (destino da entrega do balcão) — e SÓ dela.
 *
 * Mesmo desenho do aplicador de 0080–0097: sem seed, sem "aplicar pendentes".
 *   1. confere o estado: última registrada = 0097, nada ≥ 0098 registrado, função e
 *      gatilho ainda inexistentes;
 *   2. aplica numa transação própria, com lock_timeout (CREATE TRIGGER segura a tabela
 *      pedidos só por um instante — e desiste se ela estiver ocupada);
 *   3. registra em schema_migrations NA MESMA transação;
 *   4. depois do commit, confere função, gatilho, versão máxima e que os pedidos de
 *      entrega do balcão continuam exatamente iguais (md5).
 * Rollback: docs/rollback/0098_balcao_entrega_destino.down.sql.
 *
 *   node scripts/seguranca/aplicar-0098-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0098-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0098_balcao_entrega_destino.sql'
const ANTERIOR = '0097_cardapio_tamanhos_unicos_e_pizza_ocultos.sql'
const aplicar = process.argv.includes('--aplicar')
const confirmou = process.argv.includes('--confirmar-producao')

if (!process.env.DATABASE_URL) {
  try {
    for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); const eq = t.indexOf('=')
      if (!t || t.startsWith('#') || eq < 0) continue
      const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* sem .env.local */ }
}
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('❌ DATABASE_URL ausente'); process.exit(1) }
const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const loop = ['127.0.0.1', 'localhost', '::1'].includes(host)
const sql = readFileSync(join(raiz, 'supabase', 'migrations', NOME), 'utf8')

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const hora = () => new Date().toISOString()
const MD5_BALCAO = `select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||status||'|'||coalesce(atendimento_status,'')||'|'||coalesce(atualizado_em::text,''), ',' order by id),'')) h
  from pedidos where canal='balcao' and tipo='entrega'`
const estado = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
  funcao: (await um(`select count(*)::int n from pg_proc where proname='pedido_entrega_balcao_destino'`)).n,
  gatilho: (await um(`select count(*)::int n from pg_trigger where tgname='pedidos_balcao_entrega_destino' and tgrelid='public.pedidos'::regclass`)).n,
  balcao: await um(MD5_BALCAO),
})

const antes = await estado()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes))
if (antes.max !== ANTERIOR || antes.registrada || antes.funcao || antes.gatilho) {
  console.error('❌ estado inesperado (esperado: última = 0097, sem função/gatilho da 0098). Nada foi feito.')
  await c.end(); process.exit(1)
}
if (!aplicar) { console.log(`DRY-RUN ok — aplicaria ${NOME} (${sql.length} bytes).`); await c.end(); process.exit(0) }
if (!loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); await c.end(); process.exit(1) }

console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  await c.query('commit')
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${hora()} ${NOME} FALHOU e foi desfeita inteira: ${e.message}`)
  await c.end(); process.exit(1)
}
const depois = await estado()
const reg = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
console.log(`✅ ${hora()} concluída, registrada em ${reg?.aplicada_em?.toISOString?.() ?? reg?.aplicada_em}`)
const conf = [
  ['versão máxima = 0098', depois.max === NOME],
  ['função pedido_entrega_balcao_destino()', depois.funcao === 1],
  ['gatilho pedidos_balcao_entrega_destino em pedidos', depois.gatilho === 1],
  ['pedidos de entrega do balcão inalterados', depois.balcao.n === antes.balcao.n && depois.balcao.h === antes.balcao.h],
]
for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
await c.end()
if (conf.some(([, ok]) => !ok)) { console.error('❌ conferência falhou — aplicar o rollback docs/rollback/0098_balcao_entrega_destino.down.sql'); process.exit(1) }
