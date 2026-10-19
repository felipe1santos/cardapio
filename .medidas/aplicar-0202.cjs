// 0202 (origem_canal aceita ifood/keeta/99food/aiqfome): ENSAIO (aplica, confere, desfaz) e, com --aplicar, aplica.
const fs = require('fs')
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const pg = require('pg')
const sobe = fs.readFileSync('supabase/migrations/0202_origem_apps_integrados.sql', 'utf8')
const estado = async (c) => (await c.query(`select (select pg_get_constraintdef(oid) from pg_constraint where conname='pedidos_origem_canal_check') ~ 'aiqfome' chk`)).rows[0]
;(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 }); await c.connect()
  console.log('antes  ', JSON.stringify(await estado(c)))
  await c.query('begin'); await c.query(sobe); const d = await estado(c); await c.query('rollback')
  console.log('ensaio ', JSON.stringify(d), '→ desfeito')
  if (!d.chk) throw new Error('ensaio falhou')
  if (process.argv[2] === '--aplicar') { await c.query('begin'); await c.query(sobe); await c.query('commit'); console.log('APLICADA', JSON.stringify(await estado(c))) }
  await c.end()
})().catch((e) => { console.error('ERRO', e.message); process.exit(1) })
