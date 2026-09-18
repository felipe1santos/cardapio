/**
 * Aplica migrations na stack LOCAL — e só nela.
 *
 * Para o ciclo de desenvolvimento: escrever a migration, aplicar aqui, rodar as provas.
 * Cada arquivo roda na sua própria transação. Recusa qualquer banco que não seja
 * loopback: produção tem procedimento próprio (docs/MESAS-E-COMANDAS-OPERACAO.md).
 *
 *   node scripts/seguranca/aplicar-local.mjs 0071 0072     # por prefixo
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const { DB_URL } = chavesLocais()
exigirLoopback(DB_URL)

const prefixos = process.argv.slice(2)
if (prefixos.length === 0) {
  console.error('\nUso: node scripts/seguranca/aplicar-local.mjs <prefixo> [<prefixo>...]\n')
  process.exit(1)
}
if (prefixos.some((p) => p.startsWith('0054'))) {
  console.error('\n❌ A 0054 está congelada e fora deste módulo.\n')
  process.exit(1)
}

const dir = join(process.cwd(), 'supabase', 'migrations')
const todos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

const db = new pg.Client({ connectionString: DB_URL })
await db.connect()
let falhou = false
for (const prefixo of prefixos) {
  const arquivo = todos.find((f) => f.startsWith(prefixo))
  if (!arquivo) {
    console.error(`❌ nenhuma migration começa com ${prefixo}`)
    falhou = true
    continue
  }
  try {
    await db.query('begin')
    await db.query(readFileSync(join(dir, arquivo), 'utf8'))
    // Registro é conveniência: se a tabela da CLI não existir, a migration continua
    // aplicada. O savepoint impede que a falha do registro aborte a transação inteira.
    await db.query('savepoint registro')
    await db
      .query(
        `insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)
         on conflict (version) do nothing`,
        [arquivo.slice(0, 4), arquivo.replace(/\.sql$/, '')],
      )
      .catch(() => db.query('rollback to savepoint registro'))
    await db.query('commit')
    console.log(`✅ ${arquivo}`)
  } catch (e) {
    await db.query('rollback')
    console.error(`❌ ${arquivo}: ${e.message}`)
    falhou = true
    break
  }
}
await db.end()
process.exit(falhou ? 1 : 0)
