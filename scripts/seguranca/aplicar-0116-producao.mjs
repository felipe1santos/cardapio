/**
 * Aplicador da migration 0116 (configuração só pela gestão, fotos não listáveis, conversa
 * única com/sem o 9, resposta do robô não se perde) — e SÓ dela.
 *   1. preflight: última registrada = 0115, 0116 não registrada;
 *   2. backup (só com --aplicar): funções/policies trocadas + restaurantes, em
 *      BACKUP_DIR (~/backups/menuzia/<data>-pre-0116);
 *   3. foto antes/depois: restaurantes, conversas, mensagens, envios, fotos;
 *   4. DRY-RUN (padrão) aplica, confere e DESFAZ; --aplicar --confirmar-producao aplica de verdade.
 * Rollback (voltar o código antes): docs/rollback/0116_config_por_papel_fotos_conversas.down.sql
 *
 *   node scripts/seguranca/aplicar-0116-producao.mjs
 *   node scripts/seguranca/aplicar-0116-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0116_config_por_papel_fotos_conversas.sql'
const ANTERIOR = '0115_caixa_turno_automatico.sql'
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
const sql = readFileSync(join(raiz, 'supabase', 'migrations', NOME), 'utf8')

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const q = async (s, p = []) => (await c.query(s, p)).rows
const um = async (s, p = []) => (await q(s, p))[0]
const hora = () => new Date().toISOString()
const foto = async () => ({
  restaurantes: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from restaurantes x`),
  conversas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||telefone, ',' order by id),'')) h from whatsapp_conversas`),
  mensagens: await um(`select count(*)::int n from whatsapp_mensagens`),
  envios: await um(`select count(*)::int n from whatsapp_envios`),
  objetos: await um(`select count(*)::int n from storage.objects where bucket_id='cardapio'`),
})
const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})

const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0115, 0116 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}
if (aplicar) {
  const dir = process.env.BACKUP_DIR ?? join(homedir(), 'backups', 'menuzia', `${new Date().toISOString().slice(0, 10)}-pre-0116`)
  mkdirSync(dir, { recursive: true })
  const defs = await q(`select p.proname, pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('whatsapp_registrar_entrada','whatsapp_registrar_saida')`)
  writeFileSync(join(dir, 'funcoes.sql'), defs.map((d) => d.def + ';').join(String.fromCharCode(10, 10)))
  writeFileSync(join(dir, 'policies_storage.json'), JSON.stringify(await q(`select * from pg_policies where schemaname='storage' and tablename='objects'`)))
  writeFileSync(join(dir, 'restaurantes.json'), JSON.stringify(await q('select * from public.restaurantes')))
  writeFileSync(join(dir, 'LEIA-ME.txt'), `Backup antes da 0116 (${hora()}), alvo ${host}.
Rollback (voltar o código antes): docs/rollback/0116_config_por_papel_fotos_conversas.down.sql
`)
  console.log(`backup salvo em ${dir}`)
}

let fotoAntes = null
console.log(`▶ ${hora()} início ${NOME}`)
try {
  // Foto dentro de um snapshot fixo (repeatable read): pedidos e mensagens que chegam
  // durante a aplicação não contam como "mudou" — só o que a migration mexer conta.
  await c.query('begin isolation level repeatable read')
  fotoAntes = await foto()
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])
  const gatilho = await um(`select count(*)::int n from pg_trigger where not tgisinternal and tgname='restaurantes_config_so_gestao'`)
  const pol = await q(`select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('Public read of menu photos','Tenant members read their menu photos')`)
  const semExec = await um(`select count(*)::int n from information_schema.routine_privileges where routine_name in ('whatsapp_telefone_conversa','whatsapp_registrar_entrada','whatsapp_registrar_saida') and grantee in ('anon','authenticated','PUBLIC')`)
  const col = await um(`select count(*)::int n from information_schema.columns where table_name='whatsapp_mensagens' and column_name='acao_robo'`)
  const variantes = await um(`select public.whatsapp_variantes_telefone('5527992534407') v`)
  const fotoDepois = await foto()
  const mudou = Object.keys(fotoAntes).filter((k) => JSON.stringify(fotoAntes[k]) !== JSON.stringify(fotoDepois[k]))
  if (mudou.length) console.log('   (mudou: ' + mudou.join(', ') + ')')
  const conf = [
    ['gatilho de configuração só pela gestão criado', gatilho.n === 1],
    ['bucket: listagem pública removida, a da própria loja criada', pol.length === 1 && pol[0].policyname === 'Tenant members read their menu photos'],
    ['funções do WhatsApp fora do alcance de anon/authenticated', semExec.n === 0],
    ['coluna acao_robo criada', col.n === 1],
    ['variantes do telefone com e sem o 9', variantes.v.includes('552792534407') && variantes.v.includes('5527992534407')],
    ['restaurantes, conversas, mensagens, envios e fotos intactos', JSON.stringify(fotoAntes) === JSON.stringify(fotoDepois)],
  ]
  for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
  if (conf.some(([, ok]) => !ok)) throw new Error('conferência falhou')
  if (!aplicar) {
    await c.query('rollback')
    console.log(`DRY-RUN ok — tudo conferido e DESFEITO (última continua ${(await reg()).max}).`)
  } else {
    await c.query('commit')
    console.log(`✅ ${hora()} ${NOME} concluída e registrada.`)
  }
} catch (e) {
  await c.query('rollback').catch(() => {})
  console.error(`❌ ${hora()} ${NOME} ${aplicar ? 'FALHOU' : 'dry-run falhou'} e foi desfeita inteira: ${e.message}`)
  await c.end(); process.exit(1)
}
await c.end()
