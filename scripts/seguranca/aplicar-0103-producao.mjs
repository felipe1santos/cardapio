/**
 * Aplicador da migration 0103 (robô do WhatsApp v1 e fila do robô) — e SÓ dela.
 * Mesmo desenho dos aplicadores da 0098–0102: sem seed, sem "aplicar pendentes".
 *   1. preflight: última registrada = 0102, 0103 não registrada, nenhuma tabela whatsapp_*;
 *   2. foto: impressão digital de pedidos, comandas, pagamentos, lojas e fila de impressão;
 *   3. aplica numa transação própria, com lock_timeout, registrando em schema_migrations;
 *   4. confere: 5 tabelas com RLS, 5 funções fora do alcance do navegador, a config sem
 *      acesso pelo navegador, UMA linha por loja e TODAS desligadas, nenhum outro dado mudou.
 * Rollback: docs/rollback/0103_whatsapp_robo_e_fila.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0103-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0103-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0103_whatsapp_robo_e_fila.sql'
const ANTERIOR = '0102_cancelar_pedido_mesa_entregue.sql'
const TABELAS = ['whatsapp_robo_config', 'whatsapp_conversas', 'whatsapp_mensagens', 'whatsapp_envios', 'whatsapp_eventos']
const FUNCOES = [
  'public.whatsapp_registrar_entrada(uuid,text,text,boolean,text,text,timestamptz,text,text)',
  'public.whatsapp_alterar_conversa(uuid,uuid,text,uuid,text)',
  'public.whatsapp_reivindicar_envios(integer,uuid)',
  'public.whatsapp_concluir_envio(uuid,text,text,text)',
  'public.whatsapp_limpar_antigos()',
]
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
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
  comandas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from comandas x`),
  pagamentos: await um(`select count(*)::int n, coalesce(sum(valor),0)::float s from pagamentos_comanda`),
  lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||evolution_instance::text||coalesce(status_loja,''), ',' order by id),'')) h from restaurantes`),
  fila: await um(`select coalesce(sum((select count(*) from impressao_elegiveis(r.id))),0)::int n from restaurantes r`),
})
const estado = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
  tabelas: (await um(`select count(*)::int n from pg_tables where schemaname='public' and tablename = any($1)`, [TABELAS])).n,
})

const antes = await estado()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes))
if (antes.max !== ANTERIOR || antes.registrada || antes.tabelas !== 0) {
  console.error('❌ estado inesperado (esperado: última = 0102, 0103 não registrada, nenhuma tabela whatsapp_*). Nada foi feito.')
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
const rls = await um(`select count(*)::int n from pg_class where relname = any($1) and relrowsecurity`, [TABELAS])
const execNavegador = await um(`select count(*)::int n from unnest($1::text[]) f where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')`, [FUNCOES])
const cfgNavegador = await um(`select has_table_privilege('authenticated', 'public.whatsapp_robo_config', 'select') a, has_table_privilege('anon', 'public.whatsapp_robo_config', 'select') b`)
const cfgs = await um(`select count(*)::int n, count(*) filter (where robo_ativo)::int ligadas, (select count(*)::int from restaurantes) lojas from whatsapp_robo_config`)
const vazias = await um(`select (select count(*) from whatsapp_conversas)::int + (select count(*) from whatsapp_mensagens)::int + (select count(*) from whatsapp_envios)::int + (select count(*) from whatsapp_eventos)::int n`)
const fotoDepois = await foto()
const reg = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
console.log(`✅ ${hora()} concluída, registrada em ${reg?.aplicada_em?.toISOString?.() ?? reg?.aplicada_em}`)
const conf = [
  ['versão máxima = 0103', depois.max === NOME],
  ['5 tabelas criadas, todas com RLS', depois.tabelas === 5 && rls.n === 5],
  ['funções do robô fora do alcance do navegador', execNavegador.n === 0],
  ['configuração (segredos) sem leitura pelo navegador', !cfgNavegador.a && !cfgNavegador.b],
  ['uma configuração por loja, TODAS desligadas', cfgs.n === cfgs.lojas && cfgs.ligadas === 0],
  ['nenhuma conversa, mensagem, envio ou evento', vazias.n === 0],
  ['pedidos, comandas, pagamentos, lojas e fila de impressão intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
]
for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
console.log('configurações:', JSON.stringify(cfgs))
await c.end()
if (conf.some(([, ok]) => !ok)) { console.error('❌ conferência falhou — aplicar docs/rollback/0103_whatsapp_robo_e_fila.down.sql'); process.exit(1) }
