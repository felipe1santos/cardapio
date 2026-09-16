/**
 * Semente mínima da stack local para as provas do checkpoint S.
 *
 * Cria uma loja com token de impressão fictício e um item de cardápio — o
 * suficiente para que as sondas anônimas tenham uma linha real para tentar ler e
 * uma loja válida para tentar inserir pedido.
 *
 * Só loopback. O token semeado é falso e existe apenas nesta base descartável.
 */

import pg from 'pg'

const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) {
  console.error('\n❌ DB_URL precisa ser loopback.\n')
  process.exit(1)
}

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()

const { rows } = await db.query(`
  insert into restaurantes (nome, slug, impressao_agente_token, status_loja)
  values ('Loja de Teste S', 'loja-teste-s', '00000000-dead-beef-0000-000000000001'::uuid, 'aberto_manual')
  on conflict (slug) do update set nome = excluded.nome
  returning id`)
const lojaId = rows[0].id

console.log('✅ loja semeada:', lojaId, '(slug: loja-teste-s)')
await db.end()
