// 0201 (estado alterar_pedido do robô): ENSAIO (aplica, confere, desfaz) e, com --aplicar, aplica.
const fs = require('fs')
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const pg = require('pg')
const sobe = fs.readFileSync('supabase/migrations/0201_robo_alterar_pedido.sql', 'utf8')
const estado = async (c) => (await c.query(`select (select pg_get_constraintdef(oid) from pg_constraint where conname='whatsapp_conversas_auto_estado_check') ~ 'alterar_pedido' chk,
  position('alterar_pedido' in (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='whatsapp_auto_aplicar_v2')) > 0 fn`)).rows[0]
;(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect()
  console.log('antes  ', JSON.stringify(await estado(c)))
  await c.query('begin'); await c.query(sobe); const d = await estado(c); await c.query('rollback')
  console.log('ensaio ', JSON.stringify(d), '→ desfeito')
  if (!(d.chk && d.fn)) throw new Error('ensaio falhou')
  if (process.argv[2] === '--aplicar') { await c.query('begin'); await c.query(sobe); await c.query('commit'); console.log('APLICADA', JSON.stringify(await estado(c))) }
  await c.end()
})().catch((e) => { console.error('ERRO', e.message); process.exit(1) })
