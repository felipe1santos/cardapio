/**
 * Aplicador das migrations 0111 (instância do WhatsApp só pelo servidor), 0112 (campanhas:
 * descadastro e pausa) e 0113 (cancelamento só pelo servidor) — e SÓ delas, numa transação.
 *   1. preflight: última registrada = 0109, nenhuma das três registrada, instâncias sem
 *      repetição (o índice único da 0111 exige);
 *   2. backup (só com --aplicar): restaurantes (id, evolution_instance), campanhas,
 *      campanha_envios pendentes e as definições das funções/gatilhos trocados, em
 *      BACKUP_DIR (padrão ~/backups/menuzia/<data>-pre-0111);
 *   3. foto antes/depois: pedidos, lojas (instância), campanhas, envios e fila do WhatsApp;
 *   4. DRY-RUN (padrão): aplica, confere e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade, registra e confere.
 * Rollback (voltar o código antes): docs/rollback/0113…, 0112…, 0111… (nessa ordem).
 *
 *   node scripts/seguranca/aplicar-0111-0113-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0111-0113-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOMES = ['0111_whatsapp_instancia_so_servidor.sql', '0112_campanhas_descadastro_pausa.sql', '0113_cancelamento_so_servidor.sql']
const ANTERIOR = '0109_impressao_envio_direto.sql'
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
if (aplicar && !loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); process.exit(1) }
const sqls = NOMES.map((n) => readFileSync(join(raiz, 'supabase', 'migrations', n), 'utf8'))

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const hora = () => new Date().toISOString()

const foto = async () => ({
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
  instancias: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'='||coalesce(evolution_instance,''), ',' order by id),'')) h from restaurantes`),
  campanhas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status||total_enviados||total_erros, ',' order by id),'')) h from campanhas`),
  envios: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||status, ',' order by id),'')) h from campanha_envios`),
  filaWhatsapp: await um(`select count(*)::int n from whatsapp_envios`),
})
const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registradas: (await q(`select name from schema_migrations where name = any($1)`, [NOMES])).map((r) => r.name),
})

const antes = await reg()
const dup = await um(`select count(*)::int n from (select evolution_instance from restaurantes where evolution_instance is not null group by 1 having count(*) > 1) x`)
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), `instâncias repetidas: ${dup.n}`, aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registradas.length || dup.n) {
  console.error('❌ estado inesperado (esperado: última = 0109, nenhuma das três registrada, sem instância repetida). Nada foi feito.')
  await c.end(); process.exit(1)
}

if (aplicar) {
  const dir = process.env.BACKUP_DIR ?? join(homedir(), 'backups', 'menuzia', `${new Date().toISOString().slice(0, 10)}-pre-0111`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'restaurantes_instancia.json'), JSON.stringify(await q('select id, slug, evolution_instance from public.restaurantes')))
  writeFileSync(join(dir, 'campanhas.json'), JSON.stringify(await q('select * from public.campanhas')))
  writeFileSync(join(dir, 'campanha_envios_pendentes.json'), JSON.stringify(await q(`select * from public.campanha_envios where status in ('pendente','reservado')`)))
  writeFileSync(join(dir, 'funcoes.sql'), (await q(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('campanha_reservar_envios','campanha_concluir_envio')`)).map((r) => r.d + ';').join('\n\n'))
  writeFileSync(join(dir, 'grants_restaurantes.json'), JSON.stringify(await q(`select grantee, privilege_type, column_name from information_schema.column_privileges
     where table_schema='public' and table_name='restaurantes' and column_name='evolution_instance'`)))
  writeFileSync(join(dir, 'LEIA-ME.txt'), `Backup antes da 0111–0113 (${hora()}), alvo ${host}.\nRollback (voltar o código antes): docs/rollback/0113_cancelamento_so_servidor.down.sql, 0112_campanhas_descadastro_pausa.down.sql, 0111_whatsapp_instancia_so_servidor.down.sql\n`)
  console.log(`backup salvo em ${dir}`)
}

const fotoAntes = await foto()
console.log(`▶ ${hora()} início 0111–0113`)
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  for (let i = 0; i < NOMES.length; i++) {
    await c.query(sqls[i])
    await c.query('insert into schema_migrations (name) values ($1)', [NOMES[i]])
  }
  const semUpdate = await um(`select count(*)::int n from information_schema.column_privileges where table_schema='public' and table_name='restaurantes'
      and column_name='evolution_instance' and privilege_type='UPDATE' and grantee in ('authenticated','anon')`)
  const gatilhos = await um(`select count(*)::int n from pg_trigger where not tgisinternal and tgname in ('restaurantes_protege_instancia','pedidos_cancelamento_so_servidor')`)
  const indice = await um(`select count(*)::int n from pg_indexes where indexname='restaurantes_evolution_instance_uidx'`)
  const tabela = await um(`select to_regclass('public.whatsapp_descadastros') is not null ok, (select count(*)::int from public.whatsapp_descadastros) n`)
  const colunas = await um(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='campanhas' and column_name in ('incluir_descadastro','pausada_em','pausa_motivo')`)
  const semRodape = await um(`select count(*)::int n from campanhas where incluir_descadastro`)
  const saida = await um(`select count(*)::int n from information_schema.routines r join information_schema.parameters p on p.specific_name=r.specific_name
      where r.routine_schema='public' and r.routine_name='campanha_reservar_envios' and p.parameter_name='incluir_descadastro'`)
  const fotoDepois = await foto()
  const conf = [
    ['authenticated/anon sem UPDATE em evolution_instance', semUpdate.n === 0],
    ['2 gatilhos novos (instância e cancelamento)', gatilhos.n === 2],
    ['índice único de instância', indice.n === 1],
    ['tabela de descadastros criada e vazia', tabela.ok && tabela.n === 0],
    ['3 colunas novas em campanhas', colunas.n === 3],
    ['nenhuma campanha antiga ganhou o rodapé', semRodape.n === 0],
    ['seletor devolve incluir_descadastro', saida.n === 1],
    ['pedidos, instâncias, campanhas, envios e fila intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
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
    console.log(`✅ ${hora()} 0111–0113 concluídas e registradas (última ${(await reg()).max}).`)
  }
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${hora()} 0111–0113 ${aplicar ? 'FALHOU' : 'dry-run falhou'} e foi desfeita inteira: ${e.message}`)
  await c.end(); process.exit(1)
}
await c.end()
