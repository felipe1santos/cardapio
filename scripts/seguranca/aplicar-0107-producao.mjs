/**
 * Aplicador da migration 0107 (central de atendimento do WhatsApp) — e SÓ dela.
 *   1. preflight: última registrada = 0106, 0107 não registrada;
 *   2. backup (só com --aplicar): as 4 tabelas do WhatsApp que a 0107 altera e o corpo das
 *      funções que ela troca, em JSON, em BACKUP_DIR (padrão ~/backups/menuzia/<data>-pre-0107);
 *   3. foto: pedidos, comandas, pagamentos, lojas, campanhas e as tabelas do WhatsApp;
 *   4. DRY-RUN (padrão): aplica numa transação, confere e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade, registra e confere.
 *
 * Compatível com o código que já está no ar: a nova whatsapp_registrar_entrada aceita a
 * chamada antiga (p_robo_ativo tem padrão true). Ordem: aplicar a 0107, depois publicar.
 * Rollback: docs/rollback/0107_whatsapp_central_atendimento.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0107-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0107-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0107_whatsapp_central_atendimento.sql'
const ANTERIOR = '0106_taxa_manual_e_instagram.sql'
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
const q = async (s, p = []) => (await c.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const hora = () => new Date().toISOString()
const TABELAS_WA = ['whatsapp_conversas', 'whatsapp_mensagens', 'whatsapp_envios', 'whatsapp_robo_config']
const FUNCOES = ['whatsapp_registrar_entrada', 'whatsapp_alterar_conversa', 'whatsapp_limpar_antigos']

// Linhas comparadas só pelas colunas que JÁ existiam (a 0107 acrescenta colunas).
const colunasAntes = {}
for (const t of TABELAS_WA) colunasAntes[t] = (await q(`select column_name c from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).map((r) => r.c)
const idDe = (t) => (t === 'whatsapp_robo_config' ? 'restaurante_id' : 'id')
const foto = async () => {
  const f = {
    pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
    comandas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status, ',' order by id),'')) h from comandas`),
    pagamentos: await um(`select count(*)::int n, coalesce(sum(valor),0)::float s from pagamentos_comanda`),
    lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||coalesce(evolution_instance,''), ',' order by id),'')) h from restaurantes`),
    campanhas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status, ',' order by id),'')) h from campanhas`),
    campanhaEnvios: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status, ',' order by id),'')) h from campanha_envios`),
  }
  // Mensagens: o texto limitado a 90 dias e a origem são novidade — compara as colunas antigas.
  for (const t of TABELAS_WA) {
    const cols = colunasAntes[t].map((x) => `${x}::text`)
    f[t] = await um(`select count(*)::int n, md5(coalesce(string_agg(md5(concat_ws('|',${cols.join(',')})), ',' order by ${idDe(t)}),'')) h from public.${t}`)
  }
  return f
}

const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})
const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0106, 0107 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}
const contagens = {}
for (const t of TABELAS_WA) contagens[t] = (await um(`select count(*)::int n from public.${t}`)).n
console.log('linhas:', JSON.stringify(contagens))

if (aplicar) {
  const dir = process.env.BACKUP_DIR ?? join(homedir(), 'backups', 'menuzia', `${new Date().toISOString().slice(0, 10)}-pre-0107`)
  mkdirSync(dir, { recursive: true })
  for (const t of TABELAS_WA) {
    const linhas = await q(`select * from public.${t}`)
    writeFileSync(join(dir, `${t}.json`), JSON.stringify(linhas))
  }
  const defs = await q(`select p.oid::regprocedure::text assinatura, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any($1)`, [FUNCOES])
  writeFileSync(join(dir, 'funcoes.sql'), defs.map((d) => `-- ${d.assinatura}\n${d.def};\n`).join('\n'))
  writeFileSync(join(dir, 'LEIA-ME.txt'), `Backup antes da ${NOME} (${hora()}), alvo ${host}.\nTabelas em JSON (select *), funções substituídas em funcoes.sql.\nRollback: docs/rollback/0107_whatsapp_central_atendimento.down.sql\n`)
  console.log(`backup salvo em ${dir}`)
}

const fotoAntes = await foto()
console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const cv = await um(`select count(*)::int n, count(*) filter (where atendimento is null or ultima_atividade_em is null)::int ruins,
    count(*) filter (where atendimento='aguardando')::int ag, count(*) filter (where atendimento='humano')::int hu from whatsapp_conversas`)
  const ms = await um(`select count(*)::int n, count(*) filter (where origem is null)::int sem from whatsapp_mensagens`)
  const tabs = await um(`select count(*)::int n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relname in ('whatsapp_tags','whatsapp_conversa_tags') and c.relrowsecurity`)
  const fns = await q(`select p.oid::regprocedure::text a, has_function_privilege('anon', p.oid, 'execute') an, has_function_privilege('authenticated', p.oid, 'execute') au
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('whatsapp_registrar_entrada','whatsapp_registrar_saida','whatsapp_concluir_saida','whatsapp_atendimento_acao','whatsapp_alterar_conversa','whatsapp_limpar_antigos')`)
  const entrada = fns.filter((f) => f.a.startsWith('whatsapp_registrar_entrada'))
  const pub = await um(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('whatsapp_conversas','whatsapp_mensagens')`)
  const fotoDepois = await foto()
  const conf = [
    [`conversas com estado de atendimento e atividade (${cv.n}; ${cv.ag} aguardando, ${cv.hu} em atendimento)`, cv.ruins === 0],
    [`mensagens com origem (${ms.n})`, ms.sem === 0],
    ['tabelas de tags criadas com RLS', tabs.n === 2],
    ['6 funções do WhatsApp, nenhuma ao alcance do navegador', fns.length === 6 && fns.every((f) => !f.an && !f.au)],
    [`webhook: uma versão só, já com p_robo_ativo (${entrada.map((f) => f.a).join(' ; ')})`, entrada.length === 1 && entrada[0].a.split(',').length === 10 && /,\s*boolean\)$/.test(entrada[0].a)],
    ['conversas e mensagens no Realtime', pub.n === 2],
    ['pedidos, comandas, pagamentos, lojas, campanhas e dados antigos do WhatsApp intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
  ]
  for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
  if (conf.some(([, ok]) => !ok)) {
    if (JSON.stringify(fotoAntes) !== JSON.stringify(fotoDepois)) console.log('antes:', JSON.stringify(fotoAntes), '\ndepois:', JSON.stringify(fotoDepois))
    throw new Error('conferência falhou')
  }
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
