/**
 * Aplicador da migration 0114 (turno de caixa) — e SÓ dela.
 *   1. preflight: última registrada = 0113, 0114 não registrada;
 *   2. backup (só com --aplicar): fechamentos_caixa, em BACKUP_DIR (~/backups/menuzia/<data>-pre-0114);
 *   3. foto antes/depois: pedidos, fechamentos, pagamentos;
 *   4. DRY-RUN (padrão) aplica, confere e DESFAZ; --aplicar --confirmar-producao aplica de verdade.
 * Rollback (voltar o código antes): docs/rollback/0114_caixa_turnos.down.sql
 *
 *   node scripts/seguranca/aplicar-0114-producao.mjs
 *   node scripts/seguranca/aplicar-0114-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0114_caixa_turnos.sql'
const ANTERIOR = '0113_cancelamento_so_servidor.sql'
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
if (aplicar && !loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); process.exit(1) }
const sql = readFileSync(join(raiz, 'supabase', 'migrations', NOME), 'utf8')

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const hora = () => new Date().toISOString()
const foto = async () => ({
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
  fechamentos: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||valor_esperado||valor_declarado, ',' order by id),'')) h from fechamentos_caixa`),
  pagamentos: await um(`select count(*)::int n from pagamentos_comanda`),
})
const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})

const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0113, 0114 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}
if (aplicar) {
  const dir = process.env.BACKUP_DIR ?? join(homedir(), 'backups', 'menuzia', `${new Date().toISOString().slice(0, 10)}-pre-0114`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'fechamentos_caixa.json'), JSON.stringify(await q('select * from public.fechamentos_caixa')))
  writeFileSync(join(dir, 'LEIA-ME.txt'), `Backup antes da 0114 (${hora()}), alvo ${host}.\nRollback (voltar o código antes): docs/rollback/0114_caixa_turnos.down.sql\n`)
  console.log(`backup salvo em ${dir}`)
}

const fotoAntes = await foto()
console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const tabela = await um(`select to_regclass('public.caixa_turnos') is not null ok, (select count(*)::int from public.caixa_turnos) n`)
  const cols = await um(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='fechamentos_caixa' and column_name in ('turno_id','registrado_por_nome','pedidos')`)
  const unico = await um(`select count(*)::int n from pg_indexes where indexname='caixa_turnos_um_aberto_uidx'`)
  const semTurno = await um(`select count(*)::int n from fechamentos_caixa where turno_id is not null`)
  const fotoDepois = await foto()
  const conf = [
    ['tabela caixa_turnos criada e vazia', tabela.ok && tabela.n === 0],
    ['3 colunas novas em fechamentos_caixa', cols.n === 3],
    ['um turno aberto por loja (índice)', unico.n === 1],
    ['fechamentos antigos sem turno (não mudam)', semTurno.n === 0],
    ['pedidos, fechamentos e pagamentos intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
  ]
  for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
  if (conf.some(([, ok]) => !ok)) throw new Error('conferência falhou')
  if (!aplicar) {
    await c.query('rollback')
    console.log(`DRY-RUN ok — tudo conferido e DESFEITO (última continua ${(await reg()).max}).`)
  } else {
    await c.query('commit')
    console.log(`✅ ${hora()} ${NOME} concluída e registrada.`)
  }
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${hora()} ${NOME} ${aplicar ? 'FALHOU' : 'dry-run falhou'} e foi desfeita inteira: ${e.message}`)
  await c.end(); process.exit(1)
}
await c.end()
