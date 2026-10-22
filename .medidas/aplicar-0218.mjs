// Aplica a 0218 (RLS initplan). Confere, para 1 usuário por (loja, papel), quantas linhas ele vê em cada tabela com
// política — ANTES e DEPOIS da migration, na MESMA transação em REPEATABLE READ (o banco congela o instante: pedido,
// visita ou mensagem que chegar no meio não entra na conta; 22/10 a 1ª tentativa comparou com uma foto tirada fora e
// acusou +1 visita / +3 mensagens). Qualquer diferença → rollback. ENSAIO (padrão) sempre desfaz; ENSAIO=0 grava.
// Uso local: ENSAIO=0 node .medidas/aplicar-0218.mjs
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const ensaio = process.env.ENSAIO !== '0'

async function foto(usuarios, tabelas) {
  const out = {}
  for (const u of usuarios) {
    await c.query('savepoint u')
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, role: 'authenticated' })])
    await c.query('set local role authenticated')
    const linha = {}
    for (const t of tabelas) {
      await c.query('savepoint t')
      try { linha[t] = Number((await c.query(`select count(*) n from public."${t}"`)).rows[0].n) } catch (e) { linha[t] = 'ERRO ' + e.code; await c.query('rollback to savepoint t') }
    }
    await c.query('rollback to savepoint u')
    out[`${u.restaurante_id}:${u.papel}:${u.id}`] = linha
  }
  return out
}

await c.query('begin isolation level repeatable read')
try {
  await c.query("set local lock_timeout = '5s'")
  const usuarios = (await c.query(`select distinct on (restaurante_id, papel) id, papel::text, restaurante_id from public.usuarios
    where desativado_em is null and autorizado order by restaurante_id, papel, criado_em`)).rows
  const tabelas = (await c.query("select distinct tablename from pg_policies where schemaname='public' order by 1")).rows.map((r) => r.tablename)
  const antes = await foto(usuarios, tabelas)
  console.log('foto antes:', usuarios.length, 'usuários ×', tabelas.length, 'tabelas')

  await c.query(readFileSync('supabase/migrations/0218_rls_initplan.sql', 'utf8'))
  const restam = (await c.query(`select count(*)::int n from pg_policies where schemaname='public'
    and coalesce(qual,'')||coalesce(with_check,'') ~ '(public\\.)?auth_(restaurante_id|papel|e_gestor)\\(\\)'
    and coalesce(qual,'')||coalesce(with_check,'') !~* 'select\\s+(public\\.)?auth_'`)).rows[0].n
  console.log('políticas ainda sem (select):', restam)

  const depois = await foto(usuarios, tabelas)
  let difs = 0
  for (const [chave, linha] of Object.entries(antes)) {
    for (const [t, n] of Object.entries(linha)) {
      if (depois[chave]?.[t] !== n) { difs++; console.log('DIFERENÇA', chave, t, n, '→', depois[chave]?.[t]) }
    }
  }
  console.log('diferenças:', difs)
  if (difs > 0 || restam > 0) throw new Error('conferência falhou')
  if (ensaio) { await c.query('rollback'); console.log('ENSAIO ok (desfeito)') } else { await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
