// Aplica a 0218 (RLS initplan). Na MESMA transação confere, para 1 usuário por (loja, papel), quantas linhas ele vê em
// cada tabela com política — tem que ser igual à foto de antes (node .medidas/aplicar-0218.mjs foto-antes.json).
// Qualquer diferença → rollback. ENSAIO (padrão) sempre desfaz; ENSAIO=0 grava. Uso local.
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const antes = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const ensaio = process.env.ENSAIO !== '0'
await c.query('begin')
try {
  await c.query(readFileSync('supabase/migrations/0218_rls_initplan.sql', 'utf8'))
  const restam = (await c.query(`select count(*)::int n from pg_policies where schemaname='public'
    and coalesce(qual,'')||coalesce(with_check,'') ~ '(^|[^ ])(public\\.)?auth_(restaurante_id|papel|e_gestor)\\(\\)'
    and coalesce(qual,'')||coalesce(with_check,'') !~* 'select\\s+(public\\.)?auth_'`)).rows[0].n
  console.log('políticas ainda sem (select):', restam)
  let difs = 0
  for (const [chave, linha] of Object.entries(antes)) {
    const id = chave.split(':')[2]
    await c.query('savepoint u')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
    await c.query('set local role authenticated')
    for (const [t, n] of Object.entries(linha)) {
      await c.query('savepoint t')
      let agora
      try { agora = Number((await c.query(`select count(*) n from public."${t}"`)).rows[0].n) } catch (e) { agora = 'ERRO ' + e.code; await c.query('rollback to savepoint t') }
      if (agora !== n) { difs++; console.log('DIFERENÇA', chave, t, n, '→', agora) }
    }
    await c.query('rollback to savepoint u')
  }
  console.log('diferenças:', difs)
  if (difs > 0 || restam > 0) throw new Error('conferência falhou')
  if (ensaio) { await c.query('rollback'); console.log('ENSAIO ok (desfeito)') } else { await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
