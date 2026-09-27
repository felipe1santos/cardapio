/**
 * Aplicador da migration 0105 (robô do WhatsApp: proteção contra loop) — e SÓ dela.
 *   1. preflight: última registrada = 0104, 0105 não registrada;
 *   2. foto: pedidos, comandas, pagamentos, lojas, fila de impressão, campanhas, robô
 *      (config sem as colunas novas), conversas e mensagens;
 *   3. DRY-RUN (padrão): aplica numa transação, confere e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade, registra e confere.
 * Rollback: docs/rollback/0105_whatsapp_protecao_loop.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0105-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0105-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0105_whatsapp_protecao_loop.sql'
const ANTERIOR = '0104_campanhas_metricas.sql'
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
if (aplicar && !loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); process.exit(1) }

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const hora = () => new Date().toISOString()
const foto = async () => ({
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
  comandas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from comandas x`),
  pagamentos: await um(`select count(*)::int n, coalesce(sum(valor),0)::float s from pagamentos_comanda`),
  lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||coalesce(evolution_instance,'')||coalesce(status_loja,''), ',' order by id),'')) h from restaurantes`),
  fila: await um(`select coalesce(sum((select count(*) from impressao_elegiveis(r.id))),0)::int n from restaurantes r`),
  campanhas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from campanhas x`),
  envios: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from campanha_envios x`),
  robo: await um(`select md5(coalesce(string_agg(md5(concat_ws('|',restaurante_id,robo_ativo,boas_vindas,boas_vindas_horas,retorno_minutos,webhook_segredo)), ',' order by restaurante_id),'')) h from whatsapp_robo_config`),
  conversas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from whatsapp_conversas x`),
  mensagens: await um(`select count(*)::int n from whatsapp_mensagens`),
})
const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})
const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0104, 0105 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}
const fotoAntes = await foto()
console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const limites = await um(`select count(*)::int n, count(*) filter (where protecao_curta = 8 and protecao_longa = 20)::int padrao from whatsapp_robo_config`)
  const fn = await um(`select prosrc ~ 'protecao_loop' p, has_function_privilege('anon', oid, 'execute') a, has_function_privilege('authenticated', oid, 'execute') b from pg_proc where proname='whatsapp_registrar_entrada'`)
  const cks = await um(`select count(*)::int n from pg_constraint where conname in ('whatsapp_conversas_silenciada_motivo_check','whatsapp_eventos_tipo_check') and pg_get_constraintdef(oid) ~ 'protecao'`)
  const fotoDepois = await foto()
  const conf = [
    ['todas as lojas com os limites padrão (8 em 2 min, 20 em 20 min)', limites.n > 0 && limites.n === limites.padrao],
    ['função do robô com a proteção, fora do alcance do navegador', fn.p && !fn.a && !fn.b],
    ['motivo "protecao" e evento "protecao_loop" aceitos', cks.n === 2],
    ['pedidos, comandas, pagamentos, lojas, fila, campanhas, robô, conversas e mensagens intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
  ]
  for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
  if (conf.some(([, ok]) => !ok)) throw new Error('conferência falhou')
  if (!aplicar) {
    await c.query('rollback')
    console.log(`DRY-RUN ok — tudo conferido e DESFEITO (última continua ${(await reg()).max}).`)
  } else {
    await c.query('commit')
    const r = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
    console.log(`✅ ${hora()} concluída e registrada em ${r?.aplicada_em?.toISOString?.() ?? r?.aplicada_em}`)
  }
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${hora()} ${NOME} ${aplicar ? 'FALHOU' : 'dry-run falhou'} e foi desfeita inteira: ${e.message}`)
  await c.end(); process.exit(1)
}
await c.end()
