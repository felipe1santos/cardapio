/**
 * Aplicador das migrations do módulo Mesas e Comandas — e SÓ delas (0057–0072).
 *
 * Por que não `npm run db:setup`: aquele runner aplica TODAS as pendentes em ordem e
 * arrastaria a 0054 (frete), que está congelada: o DDL dela já está no schema de
 * produção sem registro em `schema_migrations`. Aqui a lista é fechada, escrita à mão,
 * e qualquer arquivo 0054 é recusado.
 *
 * Pré-condições conferidas antes de escrever qualquer coisa:
 *   - a última migration registrada é a 0056 (ou uma desta lista, em reexecução);
 *   - a 0054 não está registrada (e continua não estando depois);
 *   - nenhum arquivo da lista está fora do intervalo 0057–0072.
 *
 * Cada arquivo roda na sua própria transação e só é registrado se aplicar inteiro. Para
 * no primeiro erro. Reexecutar pula o que já foi registrado.
 *
 *   node scripts/seguranca/aplicar-mesas-producao.mjs                          # dry-run
 *   node scripts/seguranca/aplicar-mesas-producao.mjs --aplicar --confirmar-producao
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ARQUIVOS = [
  '0057_papeis_gerente_garcom.sql',
  '0058_canal_do_pedido.sql',
  '0059_colunas_equipe_auditoria_modulo.sql',
  '0060_funcoes_sessao_e_papel.sql',
  '0061_policies_pedidos_por_operacao.sql',
  '0062_policies_salao_equipe_auditoria.sql',
  '0063_mesas_qr_e_estado.sql',
  '0064_sessao_mesa_e_selecao.sql',
  '0065_ciclo_selecao_e_idempotencia.sql',
  '0066_policies_legadas_por_papel.sql',
  '0067_conta_pagamentos_transferencias.sql',
  '0068_chamados_mesa.sql',
  '0069_canal_do_item_cardapio.sql',
  '0070_comanda_cancelar_e_item_parcial.sql',
  '0071_salao_guarda_caixa_e_protecoes.sql',
  '0072_conta_desconto_numero_e_cancelamento.sql',
]

const PERMITIDAS = new Set(Array.from({ length: 16 }, (_, i) => String(57 + i).padStart(4, '0')))
for (const nome of ARQUIVOS) {
  if (nome.startsWith('0054') || !PERMITIDAS.has(nome.slice(0, 4))) {
    console.error(`\n❌ ${nome} está fora da allowlist 0057–0072. Abortando.\n`)
    process.exit(1)
  }
}

const aplicar = process.argv.includes('--aplicar')
const confirmouProducao = process.argv.includes('--confirmar-producao')

function carregarEnvLocal() {
  try {
    const raw = readFileSync(join(raiz, '.env.local'), 'utf8')
    for (const linha of raw.split('\n')) {
      const t = linha.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      const k = t.slice(0, eq).trim()
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* sem .env.local: usa só o ambiente */ }
}

if (!process.env.DATABASE_URL) carregarEnvLocal()
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) {
  console.error('\n❌ DATABASE_URL ausente.\n')
  process.exit(1)
}

const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const ehLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
const sqls = ARQUIVOS.map((nome) => ({ nome, sql: readFileSync(join(raiz, 'supabase', 'migrations', nome), 'utf8') }))

if (!aplicar) {
  console.log(`\n── DRY-RUN — alvo: ${host} ──`)
  console.log(`   ${sqls.length} arquivo(s), nesta ordem:`)
  for (const { nome, sql } of sqls) console.log(`   ${nome}  (${sql.length} bytes)`)
  console.log('\nNada foi aplicado e nenhuma conexão foi aberta. Use --aplicar --confirmar-producao.\n')
  process.exit(0)
}

if (!ehLoopback && !confirmouProducao) {
  console.error(`\n❌ alvo "${host}" sem --confirmar-producao. Abortando.\n`)
  process.exit(1)
}

const cliente = new pg.Client({ connectionString: DB_URL, ssl: ehLoopback ? undefined : { rejectUnauthorized: false } })
await cliente.connect()
console.log(`\n▶ alvo: ${host}\n`)

const registradas = new Set((await cliente.query('select name from schema_migrations')).rows.map((r) => r.name))
const ultimaAntes = [...registradas].sort().at(-1)
const d0054 = [...registradas].filter((n) => n.startsWith('0054'))
console.log(`   última registrada antes: ${ultimaAntes}`)
if (d0054.length) {
  console.error(`\n❌ a 0054 já aparece registrada (${d0054.join(', ')}). Estado inesperado; abortando.\n`)
  await cliente.end()
  process.exit(1)
}
const foraDaLista = [...registradas].filter((n) => n.slice(0, 4) > '0056' && !ARQUIVOS.includes(n))
if (foraDaLista.length) {
  console.error(`\n❌ há migrations registradas acima da 0056 fora da lista: ${foraDaLista.join(', ')}. Abortando.\n`)
  await cliente.end()
  process.exit(1)
}

for (const { nome, sql } of sqls) {
  if (registradas.has(nome)) {
    console.log(`  ⏭️  ${nome} (já registrada)`)
    continue
  }
  const t0 = Date.now()
  try {
    await cliente.query('begin')
    await cliente.query(sql)
    await cliente.query('insert into schema_migrations (name) values ($1)', [nome])
    await cliente.query('commit')
    console.log(`  ✅ ${nome}  (${Date.now() - t0} ms)`)
  } catch (err) {
    await cliente.query('rollback').catch(() => {})
    console.error(`\n❌ falhou em ${nome}: ${err.message}\n   Nada deste arquivo ficou aplicado. Os anteriores ficaram.\n`)
    await cliente.end()
    process.exit(1)
  }
}

const depois = (await cliente.query(`select name, aplicada_em from schema_migrations where name > '0056' order by name`)).rows
console.log('\n   registradas acima da 0056:')
for (const r of depois) console.log(`   ${r.name}  ${r.aplicada_em.toISOString()}`)
const ainda0054 = (await cliente.query(`select count(*)::int n from schema_migrations where name like '0054%'`)).rows[0].n
console.log(`   0054 registrada? ${ainda0054 > 0 ? 'SIM (inesperado)' : 'não'}`)
await cliente.end()
