/**
 * Registra em `schema_migrations` uma migration que JÁ FOI APLICADA em produção por outro caminho (pendência 34,
 * docs/PENDENCIAS.md). Não aplica nada: só confere no banco que o objeto da migration existe (SQL de conferência
 * deve devolver ok=true) e grava o nome no registro, para o aplicador (aplicar-migration-producao.mjs) aceitar a próxima.
 *
 *   node scripts/seguranca/registrar-migration-producao.mjs <arquivo.sql> "<sql de conferência>"   # só confere (DRY-RUN)
 *   … --confirmar-producao                                                                           # confere e registra
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [NOME, CONFERE] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const confirmou = process.argv.includes('--confirmar-producao')
if (!NOME || !CONFERE) { console.error('uso: <arquivo.sql> "<sql de conferência>" [--confirmar-producao]'); process.exit(1) }
if (!existsSync(join(raiz, 'supabase', 'migrations', NOME))) { console.error(`❌ ${NOME} não existe em supabase/migrations`); process.exit(1) }
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
const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const ja = !!(await um('select 1 from schema_migrations where name=$1', [NOME]))
const conf = await um(CONFERE)
console.log(`alvo ${host} — ${NOME}: registrada=${ja}; conferência=${JSON.stringify(conf)} ${confirmou ? '(REGISTRAR)' : '(DRY-RUN)'}`)
if (ja) { console.log('já registrada, nada a fazer'); await c.end(); process.exit(0) }
if (!conf?.ok) { console.error('❌ conferência falhou: a migration NÃO parece aplicada — use aplicar-migration-producao.mjs'); await c.end(); process.exit(1) }
if (!confirmou) { console.log('DRY-RUN ok: aplicada e sem registro. Rode de novo com --confirmar-producao para registrar.'); await c.end(); process.exit(0) }
await c.query('insert into schema_migrations (name) values ($1) on conflict do nothing', [NOME])
console.log(`✅ ${NOME} registrada (última agora: ${(await um('select max(name) m from schema_migrations')).m}).`)
await c.end()
