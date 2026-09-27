/**
 * Aplicador da migration 0104 (campanhas: disparo confiável e métricas) — e SÓ dela.
 * Mesmo desenho dos aplicadores da 0098–0103: sem seed, sem "aplicar pendentes".
 *   1. preflight: última registrada = 0103, 0104 não registrada;
 *   2. o que a 0104 encerra SEM enviar tem de ser exatamente o combinado com o dono
 *      (2026-09-27): 4 campanhas presas da estancia-burger, 95 envios pendentes;
 *   3. foto: pedidos, comandas, pagamentos, lojas, fila de impressão, robô do WhatsApp,
 *      as outras campanhas e os envios que não estavam pendentes;
 *   4. DRY-RUN (padrão): aplica numa transação, confere tudo e DESFAZ;
 *      --aplicar --confirmar-producao: aplica de verdade, registra e confere.
 * Rollback: docs/rollback/0104_campanhas_metricas.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0104-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0104-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0104_campanhas_metricas.sql'
const ANTERIOR = '0103_whatsapp_robo_e_fila.sql'
const ESPERADO = { loja: 'estancia-burger', campanhas: 4, pendentes: 95 }
const FUNCOES_SERVIDOR = [
  'public.campanha_reservar_envios(integer)',
  'public.campanha_concluir_envio(uuid,text,text,text)',
  'public.campanha_registrar_status(uuid,text,text,timestamptz)',
  'public.campanha_registrar_clique(text)',
  'public.campanha_atribuicoes(uuid,timestamptz,timestamptz)',
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
if (aplicar && !loop && !confirmou) { console.error(`❌ alvo ${host} sem --confirmar-producao`); process.exit(1) }

const c = new pg.Client({ connectionString: DB_URL, ssl: loop ? undefined : { rejectUnauthorized: false } })
await c.connect()
const um = async (s, p = []) => (await c.query(s, p)).rows[0]
const todas = async (s, p = []) => (await c.query(s, p)).rows
const hora = () => new Date().toISOString()

const presas = async () => todas(`
  select c.id, r.slug, c.status, (select count(*)::int from campanha_envios e where e.campanha_id=c.id and e.status in ('pendente','reservado')) pend
    from campanhas c join restaurantes r on r.id=c.restaurante_id
   where c.status in ('agendada','enviando') and c.agendado_em < now() - interval '24 hours' order by c.id`)
const foto = async (ids, pendIds) => ({
  pedidos: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from pedidos x`),
  comandas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.id),'')) h from comandas x`),
  pagamentos: await um(`select count(*)::int n, coalesce(sum(valor),0)::float s from pagamentos_comanda`),
  lojas: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||coalesce(evolution_instance,'')||coalesce(status_loja,''), ',' order by id),'')) h from restaurantes`),
  fila: await um(`select coalesce(sum((select count(*) from impressao_elegiveis(r.id))),0)::int n from restaurantes r`),
  robo: await um(`select md5(coalesce(string_agg(md5(row(x.*)::text), ',' order by x.restaurante_id),'')) h from whatsapp_robo_config x`),
  whatsapp: await um(`select (select count(*) from whatsapp_envios)::int e, (select count(*) from whatsapp_mensagens)::int m`),
  // Campanhas e envios que a 0104 NÃO deve tocar (colunas antigas apenas).
  outrasCampanhas: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(concat_ws('|',id,status,nome,total_enviados,total_erros,total_destinatarios)), ',' order by id),'')) h from campanhas where not (id = any($1::uuid[]))`, [ids]),
  outrosEnvios: await um(`select count(*)::int n, md5(coalesce(string_agg(md5(concat_ws('|',id,status,telefone,enviado_em)), ',' order by id),'')) h from campanha_envios where not (id = any($1::uuid[]))`, [pendIds]),
})

const reg = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
})
const antes = await reg()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes), aplicar ? '(APLICAR)' : '(DRY-RUN)')
if (antes.max !== ANTERIOR || antes.registrada) {
  console.error('❌ estado inesperado (esperado: última = 0103, 0104 não registrada). Nada foi feito.')
  await c.end(); process.exit(1)
}
const alvo = await presas()
const ids = alvo.map((x) => x.id)
const soma = alvo.reduce((s, x) => s + x.pend, 0)
console.log('campanhas presas (serão encerradas sem enviar):', JSON.stringify(alvo.map((x) => ({ loja: x.slug, status: x.status, pendentes: x.pend }))))
if (!loop && (alvo.length !== ESPERADO.campanhas || soma !== ESPERADO.pendentes || alvo.some((x) => x.slug !== ESPERADO.loja))) {
  console.error(`❌ o que seria encerrado não bate com o combinado (${ESPERADO.campanhas} campanhas da ${ESPERADO.loja}, ${ESPERADO.pendentes} pendentes). Nada foi feito.`)
  await c.end(); process.exit(1)
}
const pendIds = (await todas(`select id from campanha_envios where campanha_id = any($1::uuid[]) and status in ('pendente','reservado')`, [ids])).map((x) => x.id)
const fotoAntes = await foto(ids, pendIds)
console.log('foto antes:', JSON.stringify(fotoAntes))

console.log(`▶ ${hora()} início ${NOME}`)
let conf = []
try {
  await c.query('begin')
  await c.query(`set local lock_timeout = '15s'`)
  await c.query(sql)
  await c.query('insert into schema_migrations (name) values ($1)', [NOME])

  const encerradas = await um(`select count(*) filter (where status='cancelada')::int c, count(*)::int n from campanhas where id = any($1::uuid[])`, [ids])
  const envCanc = await um(`select count(*) filter (where status='cancelado')::int c, count(*) filter (where status in ('pendente','reservado'))::int p from campanha_envios where campanha_id = any($1::uuid[])`, [ids])
  const semFila = await um(`select count(*)::int n from campanha_envios e join campanhas c on c.id=e.campanha_id where e.status in ('pendente','reservado') and c.status in ('agendada','enviando')`)
  const execNavegador = await um(`select count(*)::int n from unnest($1::text[]) f where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')`, [FUNCOES_SERVIDOR])
  const metricasAnon = await um(`select has_function_privilege('anon', 'public.campanhas_metricas(timestamptz,timestamptz,uuid)', 'execute') a`)
  const colunas = await um(`select count(*)::int n from information_schema.columns where table_name='campanha_envios' and column_name in ('token','chave_destino','tentativas','id_externo','entregue_em','lido_em','cliques','clicado_em')`)
  const incluir = await um(`select count(*) filter (where incluir_link)::int n from campanhas`)
  const fotoDepois = await foto(ids, pendIds)
  conf = [
    ['4 campanhas presas → canceladas', encerradas.c === alvo.length && encerradas.n === alvo.length],
    [`${soma} envios pendentes → cancelados (nenhum pendente sobrou nelas)`, envCanc.c >= soma && envCanc.p === 0],
    ['nenhum envio em fila de campanha ativa (nada sai no próximo cron)', semFila.n === 0],
    ['funções do cron/webhook fora do alcance do navegador', execNavegador.n === 0],
    ['métricas fechadas para visitante', metricasAnon.a === false],
    ['colunas novas criadas', colunas.n === 8],
    ['nenhuma campanha antiga passou a incluir link', incluir.n === 0],
    ['pedidos, comandas, pagamentos, lojas, fila de impressão e robô intactos',
      ['pedidos', 'comandas', 'pagamentos', 'lojas', 'fila', 'robo', 'whatsapp'].every((k) => JSON.stringify(fotoAntes[k]) === JSON.stringify(fotoDepois[k]))],
    ['outras campanhas e envios já feitos intactos', JSON.stringify(fotoAntes.outrasCampanhas) === JSON.stringify(fotoDepois.outrasCampanhas) && JSON.stringify(fotoAntes.outrosEnvios) === JSON.stringify(fotoDepois.outrosEnvios)],
  ]
  for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
  if (conf.some(([, ok]) => !ok)) throw new Error('conferência falhou')
  if (!aplicar) {
    await c.query('rollback')
    const depois = await reg()
    console.log(`DRY-RUN ok — tudo conferido e DESFEITO (última continua ${depois.max}).`)
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
