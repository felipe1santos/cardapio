/**
 * Aplicador da migration 0101 (ordem manual dos itens e reordenação atômica) — e SÓ dela.
 * Mesmo desenho dos aplicadores da 0098–0100: sem seed, sem "aplicar pendentes".
 *   1. preflight: última registrada = 0100, 0101 não registrada, coluna e funções ausentes,
 *      nenhum empate de `criado_em` dentro da mesma loja+categoria (o backfill reproduz a
 *      ordem de hoje exatamente);
 *   2. foto: ordem atual de cada categoria (criado_em, id), catálogo e categorias;
 *   3. aplica numa transação própria, com lock_timeout, registrando em schema_migrations;
 *   4. confere: nenhum item sem posição, a ordem por `posicao` = a ordem de antes em TODA
 *      loja e categoria, catálogo e ordem das categorias intactos, funções fora do alcance
 *      do navegador.
 * Rollback: docs/rollback/0101_cardapio_ordem_itens.down.sql (voltar o código antes).
 *
 *   node scripts/seguranca/aplicar-0101-producao.mjs                       # dry-run
 *   node scripts/seguranca/aplicar-0101-producao.mjs --aplicar --confirmar-producao
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOME = '0101_cardapio_ordem_itens.sql'
const ANTERIOR = '0100_impressao_beta_modos_e_calibracao.sql'
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
  catalogo: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||nome||'|'||preco::text||'|'||status::text||'|'||coalesce(grupo_id::text,'')||'|'||mais_vendido::text||'|'||coalesce(promocao_preco::text,''), ',' order by id),'')) h from itens_cardapio`),
  categorias: await um(`select count(*)::int n, md5(coalesce(string_agg(id::text||'|'||posicao::text||'|'||coalesce(posicao_mesa::text,''), ',' order by id),'')) h from grupos_cardapio`),
  ordemHoje: await um(`select md5(coalesce(string_agg(id::text, ',' order by restaurante_id, grupo_id nulls first, criado_em, id),'')) h from itens_cardapio`),
})
const estado = async () => ({
  max: (await um(`select max(name) m from schema_migrations`)).m,
  registrada: !!(await um(`select 1 ok from schema_migrations where name=$1`, [NOME])),
  coluna: (await um(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='itens_cardapio' and column_name='posicao'`)).n,
  funcoes: (await um(`select count(*)::int n from pg_proc where proname in ('cardapio_ordenar_itens','cardapio_ordenar_categorias','itens_cardapio_posicao_padrao','grupos_cardapio_posicao_padrao')`)).n,
  empates: (await um(`select count(*)::int n from (select 1 from itens_cardapio group by restaurante_id, grupo_id, criado_em having count(*) > 1) t`)).n,
})

const antes = await estado()
console.log(`alvo ${host} — antes:`, JSON.stringify(antes))
if (antes.max !== ANTERIOR || antes.registrada || antes.coluna || antes.funcoes) {
  console.error('❌ estado inesperado (esperado: última = 0100, nada da 0101). Nada foi feito.')
  await c.end(); process.exit(1)
}
if (antes.empates) console.log(`⚠ ${antes.empates} empate(s) de criado_em na mesma categoria: o desempate passa a ser o id (determinístico).`)
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
const semPosicao = await um(`select count(*)::int n from itens_cardapio where posicao is null`)
const ordemNova = await um(`select md5(coalesce(string_agg(id::text, ',' order by restaurante_id, grupo_id nulls first, posicao, criado_em, id),'')) h from itens_cardapio`)
const priv = await um(`select has_function_privilege('authenticated', 'public.cardapio_ordenar_itens(uuid,uuid,uuid[],uuid,text)', 'execute') a,
  has_function_privilege('anon', 'public.cardapio_ordenar_categorias(uuid,uuid[],uuid,text)', 'execute') b`)
const reg = await um(`select aplicada_em from schema_migrations where name=$1`, [NOME])
console.log(`✅ ${hora()} concluída, registrada em ${reg?.aplicada_em?.toISOString?.() ?? reg?.aplicada_em}`)
const conf = [
  ['versão máxima = 0101', depois.max === NOME],
  ['coluna e 4 funções criadas', depois.coluna === 1 && depois.funcoes === 4],
  ['nenhum item sem posição', semPosicao.n === 0],
  ['ordem por posição = ordem de antes, em toda loja e categoria', ordemNova.h === fotoAntes.ordemHoje.h],
  ['catálogo intacto (nome, preço, status, categoria, favorito, promoção)', JSON.stringify(fotoAntes.catalogo) === JSON.stringify(fotoDepois.catalogo)],
  ['ordem das categorias (delivery e mesa) intacta', JSON.stringify(fotoAntes.categorias) === JSON.stringify(fotoDepois.categorias)],
  ['funções de reordenação fora do alcance do navegador', !priv.a && !priv.b],
]
for (const [n, ok] of conf) console.log(`   ${ok ? '✔' : '✘'} ${n}`)
await c.end()
if (conf.some(([, ok]) => !ok)) { console.error('❌ conferência falhou — voltar o código e aplicar docs/rollback/0101_cardapio_ordem_itens.down.sql'); process.exit(1) }
