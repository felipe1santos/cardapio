// 0200 (edição de pedido): backup de pagamentos_online (fora do git) + ENSAIO (aplica, confere, desfaz) e, com --aplicar, aplica.
const fs = require('fs'); const os = require('os')
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const pg = require('pg')
const sobe = fs.readFileSync('supabase/migrations/0200_edicao_pedido.sql', 'utf8')
const desce = fs.readFileSync('docs/rollback/0200_edicao_pedido.down.sql', 'utf8')
const estado = async (c) => (await c.query(`select
  to_regclass('public.pedido_solicitacoes') s,
  (select count(*)::int from information_schema.columns where table_name='pedidos' and column_name in ('editado_em','editado_por_nome','edicoes','diferenca_a_receber','observacao_original')) cols,
  (select count(*)::int from information_schema.columns where table_name='pagamentos_online' and column_name='devolucao_valor') dv,
  (select count(*)::int from pg_publication_tables where pubname='supabase_realtime' and tablename='pedido_solicitacoes') rt,
  (select count(*)::int from public.pagamentos_online) pagamentos,
  (select count(*)::int from public.pedidos) pedidos`)).rows[0]
;(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect()
  const b = (await c.query('select * from public.pagamentos_online')).rows
  fs.mkdirSync(`${os.homedir()}/menuzia-backups`, { recursive: true })
  const arq = `${os.homedir()}/menuzia-backups/pagamentos_online-0200-${Date.now()}.json`
  fs.writeFileSync(arq, JSON.stringify(b)); console.log('backup:', arq, `${b.length} linhas`)
  console.log('antes  ', JSON.stringify(await estado(c)))
  await c.query('begin'); await c.query(sobe); const d = await estado(c); await c.query(desce); const v = await estado(c); await c.query('rollback')
  console.log('ensaio ', JSON.stringify(d), '| rollback', JSON.stringify(v))
  if (!(d.s && d.cols === 5 && d.dv === 1 && d.rt === 1 && v.s === null && v.cols === 0 && v.dv === 0)) throw new Error('ensaio falhou')
  if (process.argv[2] === '--aplicar') { await c.query('begin'); await c.query(sobe); await c.query('commit'); console.log('APLICADA', JSON.stringify(await estado(c))) }
  await c.end()
})().catch((e) => { console.error('ERRO', e.message); process.exit(1) })
