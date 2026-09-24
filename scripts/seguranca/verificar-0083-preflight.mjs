// A 0083 não pode terminar "com sucesso" sem o índice único de número de pedido.
// Prova no banco LOCAL, dentro de uma transação desfeita no fim (nada fica gravado):
//   1. com número repetido, a migration aborta com a lista e não altera nada;
//   2. sem repetido, ela cria o índice obrigatoriamente e pode ser reaplicada.
//   node scripts/seguranca/verificar-0083-preflight.mjs
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)
const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
const res = []
const ok = (nome, passou, det = '') => { res.push(passou); console.log(`${passou ? '✔' : '✘'} ${nome}${det ? ` — ${det}` : ''}`) }
const q = async (s, p = []) => (await db.query(s, p)).rows
const SQL = readFileSync(new URL('../../supabase/migrations/0083_pdv_pedidos_estados.sql', import.meta.url), 'utf8')

await db.query('begin')
try {
  const loja = (await q(`select id from restaurantes order by criado_em limit 1`))[0].id
  await q('drop index if exists pedidos_numero_unq')
  const antes = Number((await q('select count(*) n from pedidos'))[0].n)
  for (let i = 0; i < 2; i++) {
    await q(`insert into pedidos (restaurante_id, tipo, status, subtotal, total, canal, origem, cliente_nome, numero)
             values ($1, 'retirada', 'recebido', 1, 1, 'delivery', 'cardapio', 'Verif 0083', 987654)`, [loja])
  }
  await db.query('savepoint s')
  let erro = null
  try { await db.query(SQL) } catch (e) { erro = e }
  await db.query('rollback to savepoint s')
  ok('com número repetido a 0083 aborta', /0083 abortada/.test(erro?.message ?? ''), erro?.message?.split('\n')[0])
  ok('a mensagem aponta loja e número', /numero=987654 aparece 2 vezes/.test(erro?.message ?? ''))
  ok('nenhum pedido apagado ou renumerado', Number((await q('select count(*) n from pedidos'))[0].n) === antes + 2 &&
    Number((await q(`select count(*) n from pedidos where numero = 987654 and restaurante_id = $1`, [loja]))[0].n) === 2)
  ok('o índice não foi criado no aborto', (await q(`select 1 from pg_indexes where indexname='pedidos_numero_unq'`)).length === 0)

  await q(`delete from pedidos where cliente_nome = 'Verif 0083' and numero = 987654`)
  await db.query(SQL)
  ok('sem repetido, a 0083 cria o índice obrigatoriamente', (await q(`select 1 from pg_indexes where indexname='pedidos_numero_unq'`)).length === 1)
  await db.query(SQL)
  ok('e pode ser reaplicada sem erro', true)
} catch (e) {
  ok('execução', false, e.message)
} finally {
  await db.query('rollback')
  await db.end()
}
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} passaram (transação desfeita)`)
process.exit(falhas ? 1 : 0)
