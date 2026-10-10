// 0174 em PRODUÇÃO: ensaio (padrão) aplica, testa o registro e desfaz; ENSAIO=0 grava.
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect()
const sql = readFileSync('supabase/migrations/0174_ia_uso.sql', 'utf8'), ensaio = process.env.ENSAIO !== '0'
let ok = true
const v = (rot, b, x = '') => { if (!b) ok = false; console.log(b ? '✅' : '🐞', rot, x) }
await c.query('begin')
try {
  await c.query(sql)
  const L = (await c.query(`select id from restaurantes where slug='menuzia'`)).rows[0].id
  await c.query(`select public.ia_uso_registrar($1, 'teste-ensaio', 1000, 500, 450)`, [L])
  await c.query(`select public.ia_uso_registrar($1, 'teste-ensaio', 10, 5, 4)`, [L])
  const r = (await c.query(`select escopo, chamadas, tokens_entrada, tokens_saida, custo_micro_usd from ia_uso_dia where modelo='teste-ensaio' order by escopo`)).rows
  v('total e loja somados', r.length === 2 && r.every((x) => x.chamadas === 2 && Number(x.tokens_entrada) === 1010 && Number(x.custo_micro_usd) === 454), JSON.stringify(r))
  const anon = (await c.query(`select has_table_privilege('anon','public.ia_uso_dia','select') a, has_function_privilege('authenticated','public.ia_uso_registrar(uuid,text,bigint,bigint,bigint)','execute') f`)).rows[0]
  v('anon/authenticated sem acesso', !anon.a && !anon.f)
  if (ensaio || !ok) { await c.query('rollback'); console.log(ok ? 'ENSAIO ok (desfeito)' : 'ERRO no ensaio — desfeito'); if (!ok) process.exitCode = 1 }
  else { await c.query('rollback'); await c.query('begin'); await c.query(sql); await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
