// Verifica a 0097 no banco LOCAL. Tudo roda dentro de uma transação desfeita no fim:
// nenhum dado é criado, alterado ou apagado.
//   node scripts/seguranca/verificar-tamanhos-banco.mjs
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

const INDICES = [
  'tamanhos_padrao_pizza_nome_unico', 'tamanhos_padrao_marmita_nome_unico', 'bordas_pizza_nome_unico',
  'massas_pizza_nome_unico', 'tamanhos_item_nome_unico', 'pizza_sabores_nome_unico',
]
const existentes = (await q(`select indexname from pg_indexes where indexname = any($1)`, [INDICES])).map((r) => r.indexname)
for (const i of INDICES) ok(`índice ${i}`, existentes.includes(i))

const col = (await q(`select data_type, column_default, is_nullable from information_schema.columns where table_name='itens_cardapio' and column_name='pizza_tamanhos_ocultos'`))[0]
ok('coluna pizza_tamanhos_ocultos existe, não nula, default vazio', col?.data_type === 'ARRAY' && col?.is_nullable === 'NO' && /'\{\}'/.test(col?.column_default ?? ''), JSON.stringify(col))

await db.query('begin')
try {
  const loja = (await q(`select id from restaurantes limit 1`))[0].id
  await q(`insert into tamanhos_padrao_pizza (restaurante_id, nome, posicao) values ($1, 'Verif 0097', 99)`, [loja])
  let recusou = false
  await db.query('savepoint s1')
  try { await q(`insert into tamanhos_padrao_pizza (restaurante_id, nome, posicao) values ($1, '  verif 0097 ', 99)`, [loja]) } catch (e) { recusou = e.code === '23505' }
  await db.query('rollback to savepoint s1')
  ok('banco recusa tamanho repetido (caixa/espaço) com 23505', recusou)

  const outra = (await q(`select id from restaurantes where id <> $1 limit 1`, [loja]))[0]?.id
  if (outra) {
    await q(`insert into tamanhos_padrao_pizza (restaurante_id, nome, posicao) values ($1, 'Verif 0097', 99)`, [outra])
    ok('o mesmo nome em OUTRA loja continua permitido', true)
  }
} finally {
  await db.query('rollback')
}

// Idempotência: reaplicar a migration não muda nada nem falha.
await db.query('begin')
try {
  await db.query(readFileSync(new URL('../../supabase/migrations/0097_cardapio_tamanhos_unicos_e_pizza_ocultos.sql', import.meta.url), 'utf8'))
  ok('0097 reaplicada sem erro (idempotente)', true)
} catch (e) {
  ok('0097 reaplicada sem erro (idempotente)', false, e.message)
} finally {
  await db.query('rollback')
}

await db.end()
const falhas = res.filter((x) => !x).length
console.log(`\n${res.length - falhas}/${res.length} passaram`)
process.exit(falhas ? 1 : 0)
