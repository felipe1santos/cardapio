/**
 * Aplicador da migration 0106 (taxa manual da conta + Instagram da loja) — e SÓ dela.
 *   1. preflight: última registrada = 0105, 0106 não registrada;
 *   2. foto: pedidos, comandas (colunas existentes), TOTAIS de toda conta aberta,
 *      pagamentos, lojas, fila antiga da cozinha, trabalhos do Beta e auditoria;
 *   3. DRY-RUN (padrão): aplica numa transação, confere e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade, registra e confere.
 * Rollback: docs/rollback/0106_taxa_manual_e_instagram.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0106-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0106-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0106_taxa_manual_e_instagram.sql'
const ANTERIOR = '0105_whatsapp_protecao_loop.sql'
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
  comandas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(concat_ws('|',id,status,total_final,taxa_servico_percentual,desconto_valor,desconto_percentual,taxa_entrega,taxa_entrega_cobrada,fechada_em,cancelada_em)), ',' order by id),'')) h from comandas`),
  // Toda conta aberta tem que ficar com o MESMO total (taxa manual nasce 0).
  totais: await um(`select count(*)::int n, md5(coalesce(string_agg(c.id::text||':'||t.total||':'||t.restante||':'||t.pago, ',' order by c.id),'')) h from comandas c, lateral comanda_totais(c.id) t where c.status='aberta'`),
  pagamentos: await um(`select count(*)::int n, coalesce(sum(valor),0)::float s from pagamentos_comanda`),
  lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||coalesce(status_loja,'')||coalesce(impressao_beta_modo,'')||coalesce(impressao_cozinha_por_funcao::text,''), ',' order by id),'')) h from restaurantes`),
  fila: await um(`select coalesce(sum((select count(*) from impressao_elegiveis(r.id))),0)::int n from restaurantes r`),
  reservas: await um(`select count(*)::int n from impressao_reservas`),
  trabalhos: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||estado, ',' order by id),'')) h from impressao_trabalhos`),
  auditoria: await um(`select count(*)::int n from eventos_auditoria`),
})
const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})
const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0105, 0106 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}
const fotoAntes = await foto()
console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const cols = await um(`select count(*)::int n from information_schema.columns where table_schema='public' and ((table_name='comandas' and column_name in ('taxa_extra_nome','taxa_extra_valor','taxa_extra_por_nome','taxa_extra_em')) or (table_name='restaurantes' and column_name='instagram_url'))`)
  const semTaxa = await um(`select count(*)::int n from comandas where taxa_extra_valor <> 0 or taxa_extra_nome is not null`)
  const semIg = await um(`select count(*)::int n from restaurantes where instagram_url is not null`)
  const fn = await um(`select has_function_privilege('anon', oid, 'execute') a, has_function_privilege('authenticated', oid, 'execute') b from pg_proc where proname='comanda_taxa_extra_definir'`)
  const ig = await um(`select has_column_privilege('authenticated', 'public.restaurantes', 'instagram_url', 'UPDATE') u, has_column_privilege('anon', 'public.restaurantes', 'instagram_url', 'SELECT') a`)
  const snap = await um(`select count(*)::int n from (select impressao_snapshot_pre_conta(id, 1, 'conferencia') s from comandas where status='aberta' limit 20) z where s ? 'taxa_extra' and s ? 'pedido_numero' and s ? 'atendente'`)
  const abertas = await um(`select least(count(*),20)::int n from comandas where status='aberta'`)
  const fotoDepois = await foto()
  const conf = [
    ['colunas novas criadas (4 em comandas, instagram_url em restaurantes)', cols.n === 5],
    ['nenhuma conta ganhou taxa manual; nenhuma loja ganhou Instagram', semTaxa.n === 0 && semIg.n === 0],
    ['função da taxa manual fora do alcance do navegador', fn && !fn.a && !fn.b],
    ['Instagram: dono/gerente editam pela tela (authenticated), anônimo não lê', ig.u && !ig.a],
    ['snapshot da pré-conta com os campos novos', snap.n === abertas.n],
    ['pedidos, comandas, TOTAIS das contas abertas, pagamentos, lojas, fila antiga, reservas, trabalhos do Beta e auditoria intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
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
