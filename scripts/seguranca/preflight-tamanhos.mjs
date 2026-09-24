// Preflight SOMENTE LEITURA da migration de tamanhos do cardápio.
//
//   node scripts/seguranca/preflight-tamanhos.mjs              → banco local
//   node scripts/seguranca/preflight-tamanhos.mjs --producao   → DATABASE_URL do .env.local
//
// Abre uma transação `read only` e só faz SELECT: não cria, altera nem apaga nada.
// Mostra (1) quais migrations do intervalo 0079+ estão registradas e se os objetos
// de cada uma existem no schema — `schema_migrations` sozinha não é confiável (a 0054
// está no schema e não na tabela) — e (2) os nomes repetidos que fariam a migration
// abortar. Não imprime credencial nem dado de cliente.
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const producao = process.argv.includes('--producao')
let url
if (producao) {
  const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
  url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!url) throw new Error('DATABASE_URL ausente no .env.local')
} else {
  url = chavesLocais().DB_URL
  exigirLoopback(url)
}

const db = new pg.Client({ connectionString: url, ssl: producao ? { rejectUnauthorized: false } : undefined })
await db.connect()
await db.query('begin transaction read only')
const q = async (s, p) => (await db.query(s, p)).rows
let bloqueios = 0
try {
  console.log(`Banco: ${producao ? 'PRODUÇÃO (somente leitura)' : 'local'}\n`)
  // Produção registra em public.schema_migrations (scripts/setup-db.mjs); o banco local do
  // Supabase CLI não tem essa tabela — aí valem só os sinais de schema abaixo.
  const temTabela = (await q(`select to_regclass('public.schema_migrations') is not null as e`))[0].e
  const registradas = temTabela ? (await q(`select name from schema_migrations where name >= '0079' order by name`)).map((r) => r.name) : ['(sem public.schema_migrations neste banco)']
  console.log('schema_migrations a partir de 0079:', registradas.join(', ') || '(nenhuma)')

  const coluna = async (t, c) => (await q(`select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [t, c])).length > 0
  const tabela = async (t) => (await q(`select to_regclass($1) is not null as e`, [`public.${t}`]))[0].e
  const sinais = [
    ['0079 restaurantes.entrega_sem_entregador', await coluna('restaurantes', 'entrega_sem_entregador')],
    ['0082+ (PDV v2) restaurantes.pdv_v2', await coluna('restaurantes', 'pdv_v2')],
    ['0088+ (impressão) tabela impressao_agentes', await tabela('impressao_agentes')],
    ['0095 (PDV v2) mesas.limpeza_comanda_id', await coluna('mesas', 'limpeza_comanda_id')],
    ['cardápio itens_cardapio.pizza_tamanhos_ocultos', await coluna('itens_cardapio', 'pizza_tamanhos_ocultos')],
  ]
  for (const [nome, ok] of sinais) console.log(`  ${ok ? 'existe    ' : 'não existe'}  ${nome}`)
  if (!sinais[0][1]) {
    bloqueios++
    console.log('  ✘ 0079 ausente: a migration do cardápio vem depois dela.')
  }

  console.log('\nNomes repetidos (lower(btrim(nome))) — qualquer um aborta a migration:')
  for (const [t, dono] of [
    ['tamanhos_padrao_pizza', 'restaurante_id'], ['tamanhos_padrao_marmita', 'restaurante_id'],
    ['bordas_pizza', 'restaurante_id'], ['massas_pizza', 'restaurante_id'],
    ['tamanhos_item', 'item_id'], ['pizza_sabores', 'item_id'],
  ]) {
    const loja = dono === 'item_id'
      ? `(select r.slug from itens_cardapio i join restaurantes r on r.id = i.restaurante_id where i.id = d.dono)`
      : `(select slug from restaurantes where id = d.dono)`
    const rows = await q(`select ${loja} as loja, d.chave, d.n from (
      select ${dono} as dono, lower(btrim(nome)) as chave, count(*) as n from ${t} group by 1, 2 having count(*) > 1) d order by 1, 2`)
    bloqueios += rows.length
    console.log(`  ${rows.length ? '✘' : '✔'} ${t}: ${rows.length} grupo(s)${rows.map((r) => `\n      ${r.loja}: "${r.chave}" × ${r.n}`).join('')}`)
  }
} finally {
  await db.query('rollback')
  await db.end()
}
console.log(bloqueios ? `\n✘ ${bloqueios} pendência(s): a migration abortaria. Resolva e rode de novo.` : '\n✔ Pronto para aplicar a migration do cardápio.')
process.exit(bloqueios ? 1 : 0)
