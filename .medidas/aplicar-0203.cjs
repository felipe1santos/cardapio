// 0203 (tempo_entrega/tempo_retirada em restaurantes): ENSAIO (aplica, confere, desfaz) e, com --aplicar, aplica.
const fs = require('fs')
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const pg = require('pg')
const sobe = fs.readFileSync('supabase/migrations/0203_tempo_entrega_retirada.sql', 'utf8')
const estado = async (c) => (await c.query(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='restaurantes' and column_name in ('tempo_entrega','tempo_retirada')`)).rows[0]
;(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 }); await c.connect()
  console.log('antes  ', JSON.stringify(await estado(c)))
  await c.query('begin'); await c.query(sobe); const d = await estado(c); await c.query('rollback')
  console.log('ensaio ', JSON.stringify(d), '→ desfeito')
  if (d.n !== 2) throw new Error('ensaio falhou')
  if (process.argv[2] === '--aplicar') { await c.query('begin'); await c.query(sobe); await c.query('commit'); console.log('APLICADA', JSON.stringify(await estado(c))) }
  await c.end()
})().catch((e) => { console.error('ERRO', e.message); process.exit(1) })
