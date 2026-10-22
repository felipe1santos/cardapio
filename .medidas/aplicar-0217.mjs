// Aplica a 0217 (formas de pagamento no Perfil). Aditiva: ensaio e, com ENSAIO=0, de verdade. Uso local.
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const ensaio = process.env.ENSAIO !== '0'
await c.query('begin')
try {
  const antes = (await c.query('select count(*)::int n from pedidos')).rows[0].n
  await c.query(readFileSync('supabase/migrations/0217_formas_pagamento_perfil.sql', 'utf8'))
  await c.query("select id, vale_bandeira from pedidos limit 1; select formas_pagamento from restaurantes limit 1")
  const depois = (await c.query('select count(*)::int n from pedidos')).rows[0].n
  console.log('linhas', antes, '→', depois)
  if (antes !== depois) throw new Error('conferência falhou')
  if (ensaio) { await c.query('rollback'); console.log('ENSAIO ok (desfeito)') } else { await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
