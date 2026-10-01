/**
 * Aplicador genérico de UMA migration aditiva em produção (noturno 2026-09-30).
 *   1. preflight: última registrada = <anterior>, <arquivo> não registrada;
 *   2. backup (só com --aplicar) das tabelas indicadas, em ~/backups/menuzia/<data>-pre-<num>;
 *   3. DRY-RUN (padrão): aplica, roda a conferência SQL (deve devolver ok=true) e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade e registra.
 *
 *   node scripts/seguranca/aplicar-migration-producao.mjs <arquivo.sql> <anterior.sql> <tabelas,separadas> "<sql de conferência>"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [NOME, ANTERIOR, TABELAS, CONFERE] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const aplicar = process.argv.includes('--aplicar')
const confirmou = process.argv.includes('--confirmar-producao')
if (!NOME || !ANTERIOR || !CONFERE) { console.error('uso: <arquivo> <anterior> <tabelas> "<sql conferência>"'); process.exit(1) }
for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = l.trim(); const eq = t.indexOf('=')
  if (!t || t.startsWith('#') || eq < 0) continue
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (!(k in process.env)) process.env[k] = v
}
const DB_URL = process.env.DATABASE_URL
const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const loop = ['127.0.0.1', 'localhost', '::1'].includes(host)
if (aplicar && !loop && !confirmou) { console.error('❌ sem --confirmar-producao'); process.exit(1) }
const sql = readFileSync(join(raiz, 'supabase', 'migrations', NOME), 'utf8')
const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const reg = async () => ({ max: (await um('select max(name) m from schema_migrations')).m, registrada: !!(await um('select 1 from schema_migrations where name=$1', [NOME])) })
const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) { console.error(`❌ esperado última = ${ANTERIOR} e ${NOME} não registrada. Nada foi feito.`); await c.end(); process.exit(1) }
if (aplicar) {
  const dir = join(homedir(), 'backups', 'menuzia', `${new Date().toISOString().slice(0, 10)}-pre-${NOME.slice(0, 4)}`)
  mkdirSync(dir, { recursive: true })
  for (const t of (TABELAS ?? '').split(',').filter(Boolean)) writeFileSync(join(dir, `${t}.json`), JSON.stringify((await c.query(`select * from public.${t}`)).rows))
  writeFileSync(join(dir, 'LEIA-ME.txt'), `Backup antes da ${NOME} (${new Date().toISOString()}), alvo ${host}. Rollback: docs/rollback/${NOME.replace('.sql', '.down.sql')}\n`)
  console.log(`backup salvo em ${dir}`)
}
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const conf = await um(CONFERE)
  console.log('   conferência:', JSON.stringify(conf))
  if (!conf?.ok) throw new Error('conferência falhou')
  if (!aplicar) { await c.query('rollback'); console.log(`DRY-RUN ok — DESFEITO (última continua ${(await reg()).max}).`) }
  else { await c.query('commit'); console.log(`✅ ${NOME} aplicada e registrada.`) }
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${NOME} desfeita: ${e.message}`); await c.end(); process.exit(1)
}
await c.end()
