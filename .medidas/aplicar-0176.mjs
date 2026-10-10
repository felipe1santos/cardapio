// 0176 em PRODUÇÃO: ensaio (padrão) aplica, confere e desfaz; ENSAIO=0 grava.
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect()
const sql = readFileSync('supabase/migrations/0176_modulos_pagos.sql', 'utf8'), ensaio = process.env.ENSAIO !== '0'
let ok = true
const v = (rot, b, x = '') => { if (!b) ok = false; console.log(b ? '✅' : '🐞', rot, x) }
await c.query('begin')
try {
  await c.query(sql)
  const r = (await c.query(`select r.slug, m.modulo, m.liberado from loja_modulos m join restaurantes r on r.id=m.restaurante_id order by 1,2`)).rows
  const lib = r.filter((x) => x.liberado).map((x) => `${x.slug}:${x.modulo}`)
  v('liberados só Menuzia financeiro+disparos', lib.join() === 'menuzia:disparos,menuzia:financeiro', lib.join())
  v('9 lojas × 3 módulos', r.length === 27, String(r.length))
  const f = async (slug, m) => (await c.query(`select public.modulo_liberado((select id from restaurantes where slug=$1), $2) x`, [slug, m])).rows[0].x
  v('função: menuzia financeiro sim, ponto-400 financeiro não, agente_ia ninguém', (await f('menuzia', 'financeiro')) === true && (await f('ponto-400-hamburgueria', 'financeiro')) === false && (await f('menuzia', 'agente_ia')) === false)
  v('loja sem linha = bloqueado', (await c.query(`select public.modulo_liberado(gen_random_uuid(), 'financeiro') x`)).rows[0].x === false)
  const g = (await c.query(`select has_function_privilege('authenticated','public.auth_modulo_liberado(text)','execute') a, has_function_privilege('authenticated','public.modulo_liberado(uuid,text)','execute') b, has_table_privilege('authenticated','public.loja_modulos','select') t`)).rows[0]
  v('authenticated: só auth_modulo_liberado', g.a && !g.b && !g.t, JSON.stringify(g))
  const fin = (await c.query(`select count(*)::int n from restaurantes where financeiro_ativo`)).rows[0].n
  v('financeiro_ativo intocado (9 lojas)', fin === 9, String(fin))
  if (ensaio || !ok) { await c.query('rollback'); console.log(ok ? 'ENSAIO ok (desfeito)' : 'ERRO no ensaio — desfeito'); if (!ok) process.exitCode = 1 }
  else { await c.query('rollback'); await c.query('begin'); await c.query(sql); await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
