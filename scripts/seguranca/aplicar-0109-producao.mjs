/**
 * Aplicador da migration 0109 (impressão: intensidade, envio direto, modo texto, Realtime
 * dos trabalhos e tempos) — e SÓ dela.
 *   1. preflight: última registrada = 0107, 0109 não registrada (0108 é de outra branch);
 *   2. backup (só com --aplicar): impressao_dispositivos e impressao_trabalhos (JSON) e as
 *      tabelas do Realtime, em BACKUP_DIR (padrão ~/backups/menuzia/<data>-pre-0109);
 *   3. foto: pedidos, lojas, impressoras e trabalhos (colunas que já existiam);
 *   4. DRY-RUN (padrão): aplica numa transação, confere e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade, registra e confere.
 * Rollback: docs/rollback/0109_impressao_envio_direto.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0109-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0109-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0109_impressao_envio_direto.sql'
const ANTERIOR = '0107_whatsapp_central_atendimento.sql'
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

const colunas = async (t) => (await q(`select column_name c from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).map((r) => r.c)
const colDisp = await colunas('impressao_dispositivos')
const colTrab = await colunas('impressao_trabalhos')
const hashDe = async (t, cols) => um(`select count(*)::int n, md5(coalesce(string_agg(md5(concat_ws('|',${cols.map((x) => `${x}::text`).join(',')})), ',' order by id),'')) h from public.${t}`)
const foto = async () => ({
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
  lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||coalesce(impressao_beta_modo,'')||coalesce(impressao_cozinha_por_funcao::text,''), ',' order by id),'')) h from restaurantes`),
  dispositivos: await hashDe('impressao_dispositivos', colDisp),
  trabalhos: await hashDe('impressao_trabalhos', colTrab),
  funcoes: await um(`select count(*)::int n from impressao_funcoes`),
  agentes: await um(`select count(*)::int n from impressao_agentes`),
})
const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})

const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0107, 0109 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}

if (aplicar) {
  const dir = process.env.BACKUP_DIR ?? join(homedir(), 'backups', 'menuzia', `${new Date().toISOString().slice(0, 10)}-pre-0109`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'impressao_dispositivos.json'), JSON.stringify(await q('select * from public.impressao_dispositivos')))
  writeFileSync(join(dir, 'impressao_trabalhos.json'), JSON.stringify(await q('select * from public.impressao_trabalhos')))
  writeFileSync(join(dir, 'realtime.json'), JSON.stringify(await q(`select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' order by 1,2`)))
  writeFileSync(join(dir, 'LEIA-ME.txt'), `Backup antes da ${NOME} (${hora()}), alvo ${host}.\nRollback: docs/rollback/0109_impressao_envio_direto.down.sql\n`)
  console.log(`backup salvo em ${dir}`)
}

const fotoAntes = await foto()
console.log(`▶ ${hora()} início ${NOME}`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const cols = await um(`select count(*)::int n from information_schema.columns where table_schema='public' and ((table_name='impressao_dispositivos' and column_name in ('intensidade','envio','modo_impressao','rede_ip','rede_porta')) or (table_name='impressao_trabalhos' and column_name='tempos'))`)
  const padrao = await um(`select count(*)::int n, count(*) filter (where intensidade='normal' and envio='driver' and modo_impressao='imagem' and rede_ip is null and rede_porta=9100)::int ok from impressao_dispositivos`)
  const regras = await um(`select count(*)::int n from pg_constraint where conrelid='public.impressao_dispositivos'::regclass and conname in ('impressao_dispositivos_intensidade_check','impressao_dispositivos_envio_check','impressao_dispositivos_modo_impressao_check','impressao_dispositivos_rede_ip_check','impressao_dispositivos_rede_porta_check','impressao_dispositivos_rede_com_ip_check')`)
  const pub = await um(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='impressao_trabalhos'`)
  const semTempos = await um(`select count(*)::int n from impressao_trabalhos where tempos is not null`)
  const fotoDepois = await foto()
  const conf = [
    ['6 colunas novas (5 nas impressoras, tempos nos trabalhos)', cols.n === 6],
    [`todas as ${padrao.n} impressoras ficam como hoje (driver, imagem, normal)`, padrao.n === padrao.ok],
    ['6 regras de validação criadas', regras.n === 6],
    ['trabalhos de impressão no Realtime', pub.n === 1],
    ['nenhum trabalho ganhou tempos', semTempos.n === 0],
    ['pedidos, lojas, impressoras, trabalhos, funções e computadores intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
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
