// 0170 em PRODUÇÃO: ensaio (padrão) aplica, simula na loja "teste" (dentro da transação) e desfaz; ENSAIO=0 grava.
import { readFileSync } from 'node:fs'
import pg from 'pg'
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await c.connect()
const sql = readFileSync('supabase/migrations/0170_controle_caixa_proximo_turno.sql', 'utf8'), ensaio = process.env.ENSAIO !== '0'
let ok = true
const v = (rot, b) => { if (!b) ok = false; console.log(b ? '✅' : '🐞', rot) }
await c.query('begin')
try {
  await c.query(sql)
  const T = (await c.query(`select id from restaurantes where slug='menuzia'`)).rows[0].id
  const aberto = async () => (await c.query(`select id, aberto_por_nome from caixa_turnos where restaurante_id=$1 and fechado_em is null`, [T])).rows
  await c.query(`update caixa_turnos set fechado_em=now() where restaurante_id=$1 and fechado_em is null`, [T])
  // nível 2 com o automático de ontem aberto → fecha na virada
  await c.query(`update restaurantes set financeiro_ativo=true, controle_caixa_ativo=true where id=$1`, [T])
  await c.query(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome) values ($1, now()-interval '30 hours', 'Automático (1ª venda)')`, [T])
  v('nível 2: virada fecha o automático de ontem', (await c.query(`select public.caixa_turno_virar_dia($1) n`, [T])).rows[0].n === 1 && (await aberto()).length === 0)
  // nível 2 com caixa aberto à mão ontem → NÃO fecha
  await c.query(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome) values ($1, now()-interval '30 hours', 'Gerente Teste')`, [T])
  v('nível 2: caixa aberto à mão continua aberto', (await c.query(`select public.caixa_turno_virar_dia($1) n`, [T])).rows[0].n === 0 && (await aberto()).length === 1)
  await c.query(`update caixa_turnos set fechado_em=now() where restaurante_id=$1 and fechado_em is null`, [T])
  // nível 1: fecha qualquer um de ontem (igual a antes)
  await c.query(`update restaurantes set controle_caixa_ativo=false where id=$1`, [T])
  await c.query(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome) values ($1, now()-interval '30 hours', 'Gerente Teste')`, [T])
  v('nível 1: virada fecha o de ontem (como antes)', (await c.query(`select public.caixa_turno_virar_dia($1) n`, [T])).rows[0].n === 1)
  // sem financeiro: igual
  await c.query(`update restaurantes set financeiro_ativo=false where id=$1`, [T])
  await c.query(`insert into caixa_turnos (restaurante_id, aberto_em, aberto_por_nome) values ($1, now()-interval '30 hours', 'Automático (1ª entrega)')`, [T])
  v('sem financeiro: virada igual a antes', (await c.query(`select public.caixa_turno_virar_dia($1) n`, [T])).rows[0].n === 1)
  v('loja real no nível 1 continua não estrita', (await c.query(`select public.fin_caixa_estrito(id) e from restaurantes where slug='ponto-400-hamburgueria'`)).rows[0].e === false)
  if (ensaio || !ok) { await c.query('rollback'); console.log(ok ? 'ENSAIO ok (desfeito)' : 'ERRO no ensaio — desfeito'); if (!ok) process.exitCode = 1 }
  else { await c.query('rollback'); await c.query('begin'); await c.query(sql); await c.query('commit'); console.log('APLICADA') }
} catch (e) { await c.query('rollback').catch(() => {}); console.error('ERRO', e.message); process.exitCode = 1 } finally { await c.end() }
