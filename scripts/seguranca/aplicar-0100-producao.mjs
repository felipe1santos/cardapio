/**
 * Aplicador da migration 0100 (Assistente Beta: liberação por loja, modos e calibração) —
 * e SÓ dela. Mesmo desenho dos aplicadores da 0098/0099: sem seed, sem "aplicar pendentes".
 *   1. confere o estado: última registrada = 0099, 0100 não registrada, objetos ausentes;
 *   2. tira a foto: pedidos, fila da cozinha, impressão e flags de impressão de toda loja;
 *   3. aplica numa transação própria, com lock_timeout, registrando em schema_migrations;
 *   4. confere objetos, versão, que nada da foto mudou e que TODA loja ficou com o Beta
 *      desligado, em "Somente teste" e com a cozinha no Assistente antigo.
 * Rollback: docs/rollback/0100_impressao_beta_modos_e_calibracao.down.sql.
 *
 *   node scripts/seguranca/aplicar-0100-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0100-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0100_impressao_beta_modos_e_calibracao.sql'
const ANTERIOR = '0099_taxa_entrega_so_com_item_ativo.sql'
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
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||status||'|'||total::text||'|'||impresso::text, ',' order by id),'')) h from pedidos`),
  lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||impressao_automatica::text||'|'||impressao_cozinha_por_funcao::text||'|'||coalesce(impressao_agente_token::text,''), ',' order by id),'')) h from restaurantes`),
  reservas: await um(`select count(*)::int n from impressao_reservas`),
  trabalhos: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||estado, ',' order by id),'')) h from impressao_trabalhos`),
  dispositivos: await um(`select count(*)::int n from impressao_dispositivos`),
})
const estado = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
  colunas: (await um(`select count(*)::int n from information_schema.columns where table_schema='public' and (
    (table_name='restaurantes' and column_name in ('impressao_beta_liberado','impressao_beta_modo','impressao_cozinha_transferida_em')) or
    (table_name='impressao_dispositivos' and column_name in ('largura_pontos','deslocamento_pontos','diagnostico','calibrado_em','calibrado_por_nome')))`)).n,
  funcoes: (await um(`select count(*)::int n from pg_proc where proname in ('impressao_modo_definir','impressao_calibracao_criar')`)).n,
})

const antes = await estado()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes))
if (antes.max !== ANTERIOR || antes.registrada || antes.colunas || antes.funcoes) {
  console.error('❌ estado inesperado (esperado: última = 0099, nada da 0100). Nada foi feito.')
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
const beta = await um(`select count(*)::int n, count(*) filter (where impressao_beta_liberado or impressao_beta_modo <> 'teste' or impressao_cozinha_transferida_em is not null)::int fora from restaurantes`)
const perfil = await um(`select count(*) filter (where largura_pontos is not null or deslocamento_pontos <> 0)::int n from impressao_dispositivos`)
const priv = await um(`select has_function_privilege('authenticated', 'public.impressao_modo_definir(uuid,text,uuid,text)', 'execute') a,
  has_function_privilege('anon', 'public.impressao_calibracao_criar(uuid,uuid,text,uuid,text)', 'execute') b`)
const reg = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
console.log(`✅ ${hora()} concluída, registrada em ${reg?.aplicada_em?.toISOString?.() ?? reg?.aplicada_em}`)
const conf = [
  ['versão máxima = 0100', depois.max === NOME],
  ['8 colunas e 2 funções', depois.colunas === 8 && depois.funcoes === 2],
  ['funções novas fora do alcance do navegador', !priv.a && !priv.b],
  [`toda loja (${beta.n}) com Beta desligado e em "Somente teste"`, beta.fora === 0],
  ['nenhuma impressora ganhou perfil', perfil.n === 0],
  ['nenhum pedido mudou (inclui impresso)', JSON.stringify(fotoAntes.pedidos) === JSON.stringify(fotoDepois.pedidos)],
  ['flags de impressão e token de toda loja iguais', JSON.stringify(fotoAntes.lojas) === JSON.stringify(fotoDepois.lojas)],
  ['fila de impressão (reservas, trabalhos, impressoras) igual', JSON.stringify([fotoAntes.reservas, fotoAntes.trabalhos, fotoAntes.dispositivos]) === JSON.stringify([fotoDepois.reservas, fotoDepois.trabalhos, fotoDepois.dispositivos])],
]
for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
await c.end()
if (conf.some(([, ok]) => !ok)) { console.error('❌ conferência falhou — aplicar o rollback docs/rollback/0100_impressao_beta_modos_e_calibracao.down.sql'); process.exit(1) }
