/**
 * Aplicador da migration 0102 (cancelar lançamento de mesa já servido) — e SÓ dela.
 * Mesmo desenho dos aplicadores da 0098–0101: sem seed, sem "aplicar pendentes".
 *   1. preflight: última registrada = 0101, 0102 não registrada, a função existe e ainda
 *      tem a regra antiga (entregue recusado);
 *   2. foto: impressão digital de pedidos, comandas, pagamentos e da fila de impressão;
 *   3. aplica numa transação própria, com lock_timeout, registrando em schema_migrations;
 *   4. confere: regra nova no corpo, grants iguais (navegador sem execute), nenhum dado
 *      mudou (a migration só troca a função).
 * Rollback: docs/rollback/0102_cancelar_pedido_mesa_entregue.down.sql
 *
 *   node scripts/seguranca/aplicar-0102-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0102-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0102_cancelar_pedido_mesa_entregue.sql'
const ANTERIOR = '0101_cardapio_ordem_itens.sql'
const FUNCAO = 'public.pedido_mesa_cancelar(uuid,uuid,text,uuid,text)'
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
const corpo = async () => (await um(`select pg_get_functiondef($1::regprocedure) d`, [FUNCAO])).d
const priv = async () => um(`select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') b`, [FUNCAO])
const foto = async () => ({
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status::text||reimprimir::text, ',' order by id),'')) h from pedidos`),
  comandas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status, ',' order by id),'')) h from comandas`),
  pagamentos: await um(`select count(*)::int n, coalesce(sum(valor),0)::float s from pagamentos_comanda`),
  fila: await um(`select coalesce(sum((select count(*) from impressao_elegiveis(r.id))),0)::int n from restaurantes r`),
})
const estado = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
  regraAntiga: (await corpo()).includes(`in ('cancelado', 'entregue')`),
})

const antes = await estado()
const privAntes = await priv()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), 'grants:', JSON.stringify(privAntes))
if (antes.max !== ANTERIOR || antes.registrada || !antes.regraAntiga) {
  console.error('❌ estado inesperado (esperado: última = 0101, 0102 não registrada, regra antiga na função). Nada foi feito.')
  await c.end(); process.exit(1)
}
const fotoAntes = await foto()
console.log('foto antes:', JSON.stringify(fotoAntes))
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
const d = await corpo()
const privDepois = await priv()
const fotoDepois = await foto()
const reg = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
console.log(`✅ ${hora()} concluída, registrada em ${reg?.aplicada_em?.toISOString?.() ?? reg?.aplicada_em}`)
const conf = [
  ['versão máxima = 0102', depois.max === NOME],
  ['regra nova: só "cancelado" é recusado', !depois.regraAntiga && d.includes(`if v_status = 'cancelado' then raise exception 'ja_cancelado'`)],
  ['conferência de pagamento continua na função', d.includes('comanda_conferir_pago(v_comanda)')],
  ['grants iguais (navegador sem execute)', JSON.stringify(privAntes) === JSON.stringify(privDepois)],
  ['nenhum pedido, comanda ou pagamento mudou', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
]
for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
await c.end()
if (conf.some(([, ok]) => !ok)) { console.error('❌ conferência falhou — aplicar docs/rollback/0102_cancelar_pedido_mesa_entregue.down.sql'); process.exit(1) }
