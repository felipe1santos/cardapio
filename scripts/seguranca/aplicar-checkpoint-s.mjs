/**
 * Aplicador do checkpoint de segurança S — e SÓ dele.
 *
 * Por que não `npm run db:setup`: aquele runner aplica TODAS as migrations
 * pendentes em ordem, o que arrastaria a 0054 (frete) junto — que está congelada
 * e cujo código ainda não está em produção. Este script aplica exclusivamente os
 * dois arquivos do checkpoint S e registra os dois em `schema_migrations`, do
 * mesmo jeito que o runner faria.
 *
 * Uso:
 *   node scripts/seguranca/aplicar-checkpoint-s.mjs              # dry-run: mostra o SQL e sai
 *   node scripts/seguranca/aplicar-checkpoint-s.mjs --aplicar    # aplica (loopback)
 *   DATABASE_URL=... node scripts/seguranca/aplicar-checkpoint-s.mjs --aplicar --confirmar-producao
 *
 * Sem `--confirmar-producao` o script recusa qualquer host que não seja loopback.
 * Cada arquivo roda dentro da sua própria transação: se falhar, nada fica pela
 * metade e `schema_migrations` não registra.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ARQUIVOS = [
  '0055_seg_restaurantes_colunas_publicas.sql',
  '0056_seg_pedidos_sem_insert_anonimo.sql',
]

const aplicar = process.argv.includes('--aplicar')
const confirmouProducao = process.argv.includes('--confirmar-producao')

function carregarEnvLocal() {
  try {
    const raw = readFileSync(join(raiz, '.env.local'), 'utf8')
    for (const linha of raw.split('\n')) {
      const t = linha.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      const k = t.slice(0, eq).trim()
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* sem .env.local: usa só o ambiente */ }
}

if (!process.env.DATABASE_URL) carregarEnvLocal()
const DB_URL = process.env.DB_URL ?? process.env.DATABASE_URL

if (!DB_URL) {
  console.error('\n❌ Defina DB_URL (local) ou DATABASE_URL.\n')
  process.exit(1)
}

const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const ehLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'

const sqls = ARQUIVOS.map((nome) => ({ nome, sql: readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8') }))

// O dry-run não conecta e não escreve: pode rodar contra qualquer alvo, e é
// justamente contra produção que se quer ler o SQL antes de aplicar.
if (!aplicar) {
  console.log(`\n── DRY-RUN — alvo: ${host} ──`)
  console.log(`   ${sqls.length} arquivo(s), nesta ordem: ${ARQUIVOS.join(', ')}\n`)
  for (const { nome, sql } of sqls) console.log(`\n═══ ${nome} ═══\n${sql}`)
  console.log('\nNada foi aplicado e nenhuma conexão foi aberta. Use --aplicar.\n')
  process.exit(0)
}

if (!ehLoopback && !confirmouProducao) {
  console.error(`\n❌ DB_URL aponta para "${host}" e --confirmar-producao não foi passado. Abortando.\n`)
  process.exit(1)
}

const ssl = ehLoopback ? undefined : { rejectUnauthorized: false }
const cliente = new pg.Client({ connectionString: DB_URL, ssl })
await cliente.connect()
console.log(`\n▶ alvo: ${host}\n`)

await cliente.query(`
  create table if not exists schema_migrations (
    name text primary key,
    aplicada_em timestamptz not null default now()
  )`)

for (const { nome, sql } of sqls) {
  const { rows } = await cliente.query('select 1 from schema_migrations where name = $1', [nome])
  if (rows.length) {
    console.log(`  ⏭️  ${nome} (já registrada)`)
    continue
  }
  try {
    await cliente.query('begin')
    await cliente.query(sql)
    await cliente.query('insert into schema_migrations (name) values ($1)', [nome])
    await cliente.query('commit')
    console.log(`  ✅ ${nome}`)
  } catch (err) {
    await cliente.query('rollback')
    console.error(`\n❌ falhou em ${nome}: ${err.message}\n`)
    await cliente.end()
    process.exit(1)
  }
}

await cliente.end()
console.log('\n✅ checkpoint S aplicado. Rode o verificador em seguida.\n')
