/**
 * Aplicador da migration 0099 (taxa de entrega só com item ativo) — e SÓ dela.
 *
 * Mesmo desenho do aplicador da 0098: sem seed, sem "aplicar pendentes".
 *   1. confere o estado: última registrada = 0098, 0099 não registrada, objetos ausentes;
 *   2. tira a foto: pedidos e comandas (md5) e o total de TODA conta fechada/cancelada;
 *   3. aplica numa transação própria, com lock_timeout, registrando em schema_migrations;
 *   4. confere objetos, versão, que nenhum pedido/comanda mudou e que o total de toda conta
 *      fechada/cancelada ficou idêntico (histórico preservado — ex.: comanda #8 da menuzia).
 * Rollback: docs/rollback/0099_taxa_entrega_so_com_item_ativo.down.sql.
 *
 *   node scripts/seguranca/aplicar-0099-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0099-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0099_taxa_entrega_so_com_item_ativo.sql'
const ANTERIOR = '0098_balcao_entrega_destino.sql'
const aplicar = process.argv.includes('--aplicar')
const confirmou = process.argv.includes('--confirmar-producao')

if (!process.env.DATABASE_URL) {
  try {
    for (const l of readFileSync(join(raiz, '.env.local'), 'utf8').split('\n')) {
      const t = l.trim(); const eq = t.indexOf('=')
      if (!t || t.startsWith('#') || eq < 0) continue
      const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (!(k in process.env)) process.env[k] = v
    }
  } catch { /* sem .env.local */ }
}
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error('❌ DATABASE_URL ausente'); process.exit(1) }
const host = new URL(DB_URL.replace(/^postgres(ql)?:/, 'http:')).hostname
const loop = ['127.0.0.1', 'localhost', '::1'].includes(host)
const sql = readFileSync(join(raiz, 'supabase', 'migrations', NOME), 'utf8')

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const hora = () => new Date().toISOString()
const foto = async () => ({
  pedidos: (await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||status||'|'||total::text||'|'||coalesce(taxa_entrega::text,''), ',' order by id),'')) h from pedidos`)),
  comandas: (await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||status||'|'||coalesce(taxa_entrega::text,'')||'|'||coalesce(total_final::text,''), ',' order by id),'')) h from comandas`)),
  // Total visto pela conta, para toda conta que não está aberta: tem de ficar idêntico.
  historico: (await um(`select count(*)::int n, md5(coalesce(string_agg(c.id::text||'|'||t.total::text||'|'||t.pago::text, ',' order by c.id),'')) h
    from comandas c cross join lateral public.comanda_totais(c.id) t where c.status <> 'aberta'`)),
})
const estado = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
  coluna: !!(await um(`select 1 ok from information_schema.columns where table_schema='public' and table_name='comandas' and column_name='taxa_entrega_cobrada'`)),
  efetiva: (await um(`select to_regprocedure('public.comanda_taxa_entrega_efetiva(uuid)') is not null ok`)).ok,
  gatilhos: (await um(`select count(*)::int n from pg_trigger where tgname in ('pedidos_cancelado_taxa_entrega','pedido_itens_cancelado_taxa_entrega','pedidos_novo_taxa_entrega','comandas_taxa_entrega_no_fechamento')`)).n,
})

const antes = await estado()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes))
if (antes.max !== ANTERIOR || antes.registrada || antes.coluna || antes.efetiva || antes.gatilhos) {
  console.error('❌ estado inesperado (esperado: última = 0098, nada da 0099). Nada foi feito.')
  await c.end(); process.exit(1)
}
const fotoAntes = await foto()
console.log('foto antes:', JSON.stringify(fotoAntes))
if (!aplicar) { console.log(`DRY-RUN ok — aplicaria ${NOME} (${sql.length} bytes).`); await c.end(); process.exit(0) }
if (!loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); await c.end(); process.exit(1) }

console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  await c.query('commit')
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${hora()} ${NOME} FALHOU e foi desfeita inteira: ${e.message}`)
  await c.end(); process.exit(1)
}
const depois = await estado()
const fotoDepois = await foto()
const reg = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
console.log(`✅ ${hora()} concluída, registrada em ${reg?.aplicada_em?.toISOString?.() ?? reg?.aplicada_em}`)
const conf = [
  ['versão máxima = 0099', depois.max === NOME],
  ['coluna taxa_entrega_cobrada, função e 4 gatilhos', depois.coluna && depois.efetiva && depois.gatilhos === 4],
  ['nenhum pedido mudou', JSON.stringify(fotoAntes.pedidos) === JSON.stringify(fotoDepois.pedidos)],
  ['nenhuma comanda mudou', JSON.stringify(fotoAntes.comandas) === JSON.stringify(fotoDepois.comandas)],
  ['total de toda conta fechada/cancelada idêntico (histórico)', JSON.stringify(fotoAntes.historico) === JSON.stringify(fotoDepois.historico)],
]
for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
await c.end()
if (conf.some(([, ok]) => !ok)) { console.error('❌ conferência falhou — aplicar o rollback docs/rollback/0099_taxa_entrega_so_com_item_ativo.down.sql'); process.exit(1) }
