// Preflight SOMENTE LEITURA das migrations 0080–0096 (PDV v2 + impressão).
//   node scripts/seguranca/preflight-pdv-v2-impressao.mjs              → banco local
//   node scripts/seguranca/preflight-pdv-v2-impressao.mjs --producao   → DATABASE_URL do .env.local
//
// Transação `read only`, só SELECT. Confere o que faria alguma migration falhar ou
// deixar dado inconsistente: constraints novas que valem para linhas existentes,
// índices únicos, objetos que já existiriam por fora do controle de migrations.
import pg from 'pg'
import { readFileSync } from 'node:fs'
import { chavesLocais, exigirLoopback } from './chaves-locais.mjs'

const producao = process.argv.includes('--producao')
let url
if (producao) {
  const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
  url = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '')
} else {
  url = chavesLocais().DB_URL
  exigirLoopback(url)
}
const db = new pg.Client({ connectionString: url, ssl: producao ? { rejectUnauthorized: false } : undefined })
await db.connect()
await db.query('begin transaction read only')
const q = async (s, p) => (await db.query(s, p)).rows
const n = async (s) => Number((await q(s))[0].n)
let bloqueios = 0
const linha = (ok, texto) => { if (!ok) bloqueios++; console.log(`  ${ok ? '✔' : '✘'} ${texto}`) }
const existe = async (t) => (await q(`select to_regclass($1) is not null as e`, [`public.${t}`]))[0].e
const coluna = async (t, c) => (await q(`select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`, [t, c])).length > 0
try {
  console.log(`Banco: ${producao ? 'PRODUÇÃO (somente leitura)' : 'local'}\n`)
  const temSM = (await q(`select to_regclass('public.schema_migrations') is not null as e`))[0].e
  if (temSM) {
    const reg = (await q(`select name from schema_migrations order by name`)).map((r) => r.name)
    const acima = reg.filter((r) => r.slice(0, 4) >= '0080')
    console.log(`schema_migrations: última ${reg.at(-1)}; registradas ≥ 0080: ${acima.join(', ') || 'nenhuma'}`)
    linha(reg.includes('0079_entrega_sem_entregador.sql'), '0079 registrada (base esperada)')
  }

  console.log('\n0082 (comandas de balcão):')
  if (!(await coluna('comandas', 'tipo'))) {
    linha((await n(`select count(*) n from comandas where mesa_id is null`)) === 0, 'toda comanda existente tem mesa (comandas_tipo_mesa_check)')
  } else console.log('  · coluna comandas.tipo já existe')
  console.log('\n0083 (estados do pedido):')
  linha((await n(`select count(*) n from (select 1 from pedidos group by restaurante_id, numero having count(*) > 1) d`)) === 0, 'nenhum número de pedido repetido na mesma loja (pedidos_numero_unq)')
  linha((await n(`select count(*) n from pedidos where numero is null`)) === 0, 'nenhum pedido sem número')
  console.log('\n0084 (pagamentos com canal/origem):')
  console.log(`  · ${await n(`select count(*) n from pagamentos_comanda`)} pagamento(s) existentes recebem canal='mesa', origem='salao' (colunas novas; nada existente muda)`)
  console.log('\n0088–0090 (impressão): tabelas novas não podem existir por fora')
  for (const t of ['impressao_reservas', 'impressao_agentes', 'impressao_pareamentos', 'impressao_dispositivos', 'impressao_funcoes', 'impressao_trabalhos']) {
    linha(!(await existe(t)), `${t} ainda não existe`)
  }
  console.log('\n0080 (isolamento de restaurantes):')
  linha(await coluna('restaurantes', 'impressao_agente_token'), 'coluna impressao_agente_token existe (0080 tira do navegador)')
  const tokensLojas = await n(`select count(*) n from restaurantes where impressao_agente_token is not null`)
  console.log(`  · ${tokensLojas} loja(s) com token do Assistente — o token NÃO muda (só deixa de ser legível no navegador)`)
  console.log('\nFlags depois das migrations: pdv_v2 e impressao_cozinha_por_funcao nascem false (default da coluna).')
} finally {
  await db.query('rollback')
  await db.end()
}
console.log(bloqueios ? `\n✘ ${bloqueios} bloqueio(s).` : '\n✔ Nenhum bloqueio para 0080–0096.')
process.exit(bloqueios ? 1 : 0)
